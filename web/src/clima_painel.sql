-- Resumo do painel de clima: uma linha por grupo (BR, sigla da UF ou código IBGE do município com 7 dígitos) e variável.
-- UMA regra para os dois caminhos: o gerador (pipeline/clima_painel.py) e o site, quando o arquivo leve não existe (dados.ts).
-- Quem usa define antes as CTEs de entrada, na mesma consulta (WITH ... ,), e cola este texto em seguida:
--   a   (grupo, variavel, ano, valor, normal, anomalia_pct, anomalia)  anos COMPLETOS publicados (12 meses)
--   s   (grupo, variavel, ano, mes, valor)                              meses publicados (ausência = sem linha, nunca zero)
--   n   (grupo, variavel, mes, normal)                                  normal 1991–2020 por mês
--   agr (variavel, agregacao, tipo)                                     'soma' ou 'media'; anomalia 'pct' ou 'abs'
-- Nada aqui recalcula o que já está publicado: o ano completo, a normal e a anomalia vêm de `a`. Brasil e UF usam a
-- ponderação por área já presente em `a` e `s`; este texto nunca faz média simples nem pondera por população.
anos AS (SELECT unnest(generate_series(1900, 2100)) AS y),
ref AS (
  SELECT grupo, variavel, min(ano) AS ano_de, max(ano) AS ano_ate, count(*) AS n_anos,
         arg_max(valor, ano) AS valor, arg_max(normal, ano) AS normal,
         arg_max(anomalia_pct, ano) AS anomalia_pct, arg_max(anomalia, ano) AS anomalia
  FROM a GROUP BY grupo, variavel
),
lac AS (
  -- anos entre o primeiro e o último ano completo que não fecham (ex.: evaporação e radiação em 2022–2024)
  SELECT r.grupo, r.variavel, string_agg(CAST(y.y AS VARCHAR), ',' ORDER BY y.y) AS anos_lacuna
  FROM ref r
  JOIN anos y ON y.y BETWEEN r.ano_de AND r.ano_ate
  LEFT JOIN a ON a.grupo = r.grupo AND a.variavel = r.variavel AND a.ano = y.y
  WHERE a.ano IS NULL
  GROUP BY r.grupo, r.variavel
),
fim AS (SELECT grupo, variavel, max(ano * 100 + mes) AS ate FROM s GROUP BY grupo, variavel),
par AS (
  -- ano em curso: só os meses de janeiro em diante, todos presentes, contra a normal dos MESMOS meses
  SELECT r.grupo, r.variavel, count(*) AS parcial_meses,
         CASE WHEN g.agregacao = 'soma' THEN sum(s.valor) ELSE avg(s.valor) END AS parcial_valor,
         CASE WHEN g.agregacao = 'soma' THEN sum(n.normal) ELSE avg(n.normal) END AS parcial_normal
  FROM ref r
  JOIN s ON s.grupo = r.grupo AND s.variavel = r.variavel AND s.ano = r.ano_ate + 1
  JOIN agr g ON g.variavel = r.variavel
  LEFT JOIN n ON n.grupo = s.grupo AND n.variavel = s.variavel AND n.mes = s.mes
  GROUP BY r.grupo, r.variavel, g.agregacao
  HAVING count(*) = max(s.mes) AND count(*) < 12 AND count(n.normal) = count(*)
),
win AS (SELECT unnest([3, 6, 12]) AS k),
acum AS (
  -- chuva acumulada nos k meses que terminam no último mês publicado; só vale com os k meses presentes
  SELECT f.grupo, w.k, f.ate, count(s.valor) AS cob, sum(s.valor) AS soma, sum(n.normal) AS soma_normal, count(n.normal) AS cn
  FROM fim f
  CROSS JOIN win w
  JOIN s ON s.grupo = f.grupo AND s.variavel = f.variavel
        AND (s.ano * 12 + s.mes - 1) BETWEEN ((f.ate // 100) * 12 + f.ate % 100 - 1) - w.k + 1 AND ((f.ate // 100) * 12 + f.ate % 100 - 1)
  LEFT JOIN n ON n.grupo = s.grupo AND n.variavel = s.variavel AND n.mes = s.mes
  WHERE f.variavel = 'chuva_mm'
  GROUP BY f.grupo, w.k, f.ate
),
acum_p AS (
  SELECT grupo, max(ate) AS acum_fim,
    max(CASE WHEN k = 3 THEN cob END) AS acum3_cob,
    max(CASE WHEN k = 3 AND cob = 3 THEN soma END) AS acum3_valor,
    max(CASE WHEN k = 3 AND cob = 3 AND cn = 3 THEN soma_normal END) AS acum3_normal,
    max(CASE WHEN k = 6 THEN cob END) AS acum6_cob,
    max(CASE WHEN k = 6 AND cob = 6 THEN soma END) AS acum6_valor,
    max(CASE WHEN k = 6 AND cob = 6 AND cn = 6 THEN soma_normal END) AS acum6_normal,
    max(CASE WHEN k = 12 THEN cob END) AS acum12_cob,
    max(CASE WHEN k = 12 AND cob = 12 THEN soma END) AS acum12_valor,
    max(CASE WHEN k = 12 AND cob = 12 AND cn = 12 THEN soma_normal END) AS acum12_normal
  FROM acum GROUP BY grupo
)
SELECT r.grupo, r.variavel, r.ano_de, r.ano_ate, r.n_anos, l.anos_lacuna, f.ate,
       r.valor, r.normal, r.anomalia_pct, r.anomalia,
       p.parcial_meses, p.parcial_valor, p.parcial_normal,
       CASE WHEN g.tipo = 'pct' AND p.parcial_normal > 0 THEN p.parcial_valor / p.parcial_normal - 1 END AS parcial_anomalia_pct,
       CASE WHEN g.tipo = 'abs' THEN p.parcial_valor - p.parcial_normal END AS parcial_anomalia,
       u.acum_fim, u.acum3_cob, u.acum3_valor, u.acum3_normal, u.acum6_cob, u.acum6_valor, u.acum6_normal,
       u.acum12_cob, u.acum12_valor, u.acum12_normal
FROM ref r
JOIN agr g ON g.variavel = r.variavel
LEFT JOIN lac l ON l.grupo = r.grupo AND l.variavel = r.variavel
LEFT JOIN fim f ON f.grupo = r.grupo AND f.variavel = r.variavel
LEFT JOIN par p ON p.grupo = r.grupo AND p.variavel = r.variavel
LEFT JOIN acum_p u ON u.grupo = r.grupo AND r.variavel = 'chuva_mm'
