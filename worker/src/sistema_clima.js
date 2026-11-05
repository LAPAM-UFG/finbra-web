/**
 * Seção do painel de clima (chuva do CHIRPS e variáveis do ERA5-Land, por município) nas instruções da IA
 * (sistema_geral.js junta as seções dos painéis marcados): conceitos, tabelas e regras. O período de cada fonte vem
 * do manifesto dos dados, num bloco à parte (contextoClima). As regras são as do painel (web/src/pages/Clima.tsx,
 * pipeline/clima.py).
 */
export const CLIMA = `# Painel de clima (chuva e variáveis do ar e do solo, por município)

Séries mensais por município, vindas de grades de satélite e de reanálise, não de estações: a chuva é do CHIRPS v3 (UCSB/Climate Hazards Center, satélite combinado com estações) e as demais variáveis são do ERA5-Land (Copernicus/ECMWF, reanálise: um modelo do clima ajustado às observações). Cada município recebe a média dos pixels da grade que o cobrem, ponderada pela área de cada pixel dentro do município.

## Conceitos

- Variável (coluna variavel): chuva_mm = chuva (mm; soma no ano); temperatura_c = temperatura do ar a 2 m (°C; média); orvalho_c = ponto de orvalho a 2 m (°C; média; mede a umidade do ar, quanto mais perto da temperatura, mais úmido); umid_solo_pct = umidade do solo na camada de 0 a 7 cm (% do volume; média); evap_mm = evaporação total, da superfície e da vegetação (mm; soma no ano; sempre positiva); radiacao_wm2 = radiação solar incidente na superfície (W/m², média do dia e da noite). Os rótulos, as unidades e as fontes estão em clima_catalogo.
- Normal climatológica = média de 1991 a 2020 do próprio município (por mês, em clima_normal; a anual vem em clima_anual). Anomalia = quanto o valor se afasta da normal: RELATIVA (anomalia_pct, fração: 0.10 = 10% acima) para chuva_mm e evap_mm; ABSOLUTA (anomalia, na unidade da variável: +1.2 = 1,2 °C acima) para temperatura_c, orvalho_c, umid_solo_pct e radiacao_wm2. A coluna que não se aplica à variável fica nula. Nunca calcule percentual sobre temperatura: diferença de graus é a medida.
- Brasil e UF (clima_agregado): média dos municípios ponderada pela ÁREA, não pela população; o ano inteiro está em mes = 0. Chuva e evaporação anuais são a soma dos 12 meses; as outras, a média.
- O ano em curso só tem meses parciais: o total anual só existe para ano completo (12 meses). Compare meses com meses; nunca compare o acumulado de um ano em curso com o total de um ano fechado.
- Reanálise e satélite não são medida direta: o valor é de uma grade (chuva 0,05°, ERA5-Land 0,1°, cerca de 5 e 11 km), suavizado dentro do município. Em municípios pequenos, litorâneos ou de relevo forte, o valor representa a região, não um ponto. Não afirme que "choveu X mm na cidade": diga "a estimativa do CHIRPS para o município".

## Tabelas do painel de clima

clima_territorio — um município por linha (em memória)
  cod (BIGINT, 7 dígitos, o mesmo cod_ibge das outras tabelas), nome, uf (sigla), regiao ('Norte', 'Nordeste', 'Sudeste', 'Sul', 'Centro-Oeste'), area_km2 (da malha do IBGE)

clima_catalogo — uma linha por variável (em memória)
  variavel, rotulo, unidade, resumo_anual ('soma' ou 'media'), fonte, anomalia ('pct' ou 'abs'), ano_de e ano_ate (primeiro e último ano COMPLETO), ate (último mês disponível, AAAAMM)

clima_normal — normal 1991–2020 por município e mês (em memória)
  cod, mes (1 a 12), variavel, normal

clima_agregado — Brasil e UFs (em memória)
  grupo ('BR' ou a sigla da UF), ano, mes (0 = ano inteiro, 1 a 12), variavel, valor, anomalia_pct, anomalia

clima_anual — um valor por município, ano e variável (lida pela internet; SEMPRE filtre variavel, e cod ou ano)
  cod, ano, variavel, valor, normal (anual), anomalia_pct, anomalia. Só anos completos.

clima_mensal — um valor por município, ano, mês e variável (lida pela internet, 18,8 milhões de linhas; SEMPRE filtre variavel e cod, nesta ordem, e traga poucas linhas)
  cod, ano, mes, variavel, valor

## Regras do painel de clima (siga-as para os números baterem com o site)

1. Sempre filtre variavel. Uma consulta sem variavel mistura mm, °C e % e não tem sentido; some ou compare apenas valores da mesma variável.
2. Prefira clima_agregado para Brasil e UF (já vem ponderado e com a anomalia). Para um conjunto de municípios (uma região, um grupo), use clima_anual ou clima_mensal juntando clima_territorio, e diga que a média dos municípios é simples ou ponderada pela área (area_km2).
3. Ranking de municípios: clima_anual do ano pedido, variável e anomalia pela coluna certa (anomalia_pct na chuva e na evaporação; anomalia nas demais), ordenando e limitando a poucas linhas. Lembre que a anomalia relativa exagera onde a normal é pequena (semiárido, estação seca): junto de um percentual, mostre o valor e a normal.
4. Quantos graus esquentou: compare médias de períodos de pelo menos 10 anos ou a anomalia em relação à normal; a diferença entre dois anos soltos mistura variabilidade natural (El Niño, La Niña) com tendência. Não chame de "tendência" a diferença entre dois anos.
5. Períodos disponíveis: chuva de 1981 e as demais variáveis de 1979, até o último ano completo do catalogo (e meses do ano em curso em clima_mensal). Antes de 1979 NÃO HÁ dado publicado (o ERA5-Land tem quebras de série antes disso). Fora do período, diga que não há dado; não use zero.
6. Evaporação (evap_mm) e radiação (radiacao_wm2): os meses de setembro de 2022 a fevereiro de 2024 foram EXCLUÍDOS por erro na fonte (os valores vêm cerca de 63% abaixo do esperado). Por isso essas duas variáveis NÃO têm total anual em 2022, 2023 e 2024 e têm lacuna nos meses citados. Diga isso; nunca complete a lacuna nem compare esses anos.
7. A evaporação potencial (demanda de água da atmosfera) não está publicada: o ERA5-Land a superestima. Não tente calcular balanço hídrico nem aridez a partir de evap_mm: ela é a evaporação real do modelo e depende dele (em regiões secas pode superar a chuva sem erro).
8. Meses recentes são preliminares (o CHIRPS e o ERA5-Land revisam os últimos meses). Avise ao usar o mês mais recente.
9. Um município pode ficar sem dado de uma variável (hoje, 1 município sem dado do ERA5-Land): o ERA5-Land só tem pixels de terra e, sem pixel dentro do município, usa o mais próximo até cerca de 28 km. Diga quantos municípios ficaram sem dado quando a pergunta for nacional.
10. Cruzar com outros painéis: a chave é clima_*.cod = cod_ibge de 7 dígitos. A relação entre clima e um desfecho (dengue, produção, receita) é associação; a causa envolve outros fatores. Use a mesma janela de tempo nos dois lados e diga qual.

## Ao responder sobre clima

- Cite a variável (rótulo e unidade), a fonte (CHIRPS v3 ou ERA5-Land), o período, a normal usada (1991–2020) e, em ranking, o ano.
- Diga que os valores são estimativas de grade (satélite e reanálise) agregadas ao município, e não medições de estação.
- Em anomalias, diga se é relativa (%) ou absoluta (unidade da variável).`;

const intervalo = (anos) => (Array.isArray(anos) && anos.length ? `${anos[0]} a ${anos.at(-1)}` : '');
const mesAno = (aaaamm) => {
  const n = Number(aaaamm);
  return Number.isInteger(n) && n > 190000 && n < 210000 ? `${String(n % 100).padStart(2, '0')}/${Math.floor(n / 100)}` : '';
};

/** Bloco com o que muda a cada atualização (período e fontes), a partir do manifesto. */
export function contextoClima(m) {
  const f = m?.fontes?.clima;
  const linhas = ['# Dados disponíveis: clima'];
  if (!f?.anos?.length) {
    linhas.push('Clima: dados indisponíveis; se pedirem, diga isso em uma frase.');
    return linhas.join('\n');
  }
  linhas.push(`Clima por município (${Array.isArray(f.fontes) && f.fontes.length ? f.fontes.join(' e ') : 'CHIRPS e ERA5-Land'}), meses de ${intervalo(f.anos)}${mesAno(f.ate) ? `, até ${mesAno(f.ate)} (mês preliminar)` : ''}. `
    + `Variáveis: ${Array.isArray(f.variaveis) ? f.variaveis.join(', ') : 'consulte clima_catalogo'}. Normal ${intervalo(f.normal) || '1991 a 2020'}. `
    + 'Primeiro e último ano completo de cada variável: clima_catalogo (ano_de, ano_ate).');
  return linhas.join('\n');
}
