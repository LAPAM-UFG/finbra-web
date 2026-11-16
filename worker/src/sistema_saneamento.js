/** Os nomes e a cobertura vêm do mesmo catálogo independente do painel. */
export const SANEAMENTO=`## SANEAMENTO — SNIS / SINISA
Tabela saneamento_indicadores, uma linha por grupo, ano e indicador.
Colunas: grupo VARCHAR (código IBGE municipal de 7 dígitos, sigla da UF ou BR), nivel (M, UF, BR), cod_ibge (só M), nome, uf, ano, indicador VARCHAR, valor DOUBLE, unidade, numerador, denominador, condicao, municipios_com_dado, municipios_cadastro, sistema.
Sempre filtre indicador, ano e nivel/grupo. Brasil usa grupo='BR', UF usa grupo='GO' (por exemplo). Esses agregados já estão prontos: nunca some municípios e agregados juntos, nem tire a média dos percentuais municipais. Os agregados são razões de somas dos mesmos municípios válidos e ano. São cálculos LAPAM, não estimativas oficiais para os municípios sem resposta. Informe a cobertura municipios_com_dado/municipios_cadastro; o cadastro é atual.
Condição: 0 observado; 1 sem registro; 2 denominador ausente; 3 denominador zero; 4 inconsistência na origem; 5 fora da cobertura; 6 sem resposta ao módulo. Valor NULL não é zero: não use COALESCE(valor,0). Zero com condição 0 é válido. Para rankings filtre nivel='M' e condicao=0; posição não significa qualidade da gestão. Valores percentuais já estão em 0–100. m3_ano são m³ por ano; t_ano são toneladas por ano.
SNIS 2013–2022; SINISA 2023–2024. Não trate 2022→2023 como variação comparável: mudaram fórmulas e cobertura. Drenagem só 2015, 2017–2024; nunca interpole 2016. Água/esgoto com rede não incluem automaticamente soluções individuais. Resíduos e drenagem têm denominadores próprios, não assuma que sejam os mesmos de água.
Para detalhes de componentes ou lista de indicadores use o catálogo abaixo. Não invente nomes de colunas. Para comparar anos declare mudanças de composição dos municípios respondentes. Brasília (5300108) e DF cobrem a mesma área; nunca some os dois.`;
export function contextoSaneamento(m){
 if(!m?.indicadores?.length)return 'Catálogo de saneamento indisponível: não suponha indicadores ou cobertura; informe a limitação.';
 return 'Catálogo de saneamento, versão '+m.gerado_em+'\n'+m.indicadores.map(i=>`${i.id}: ${i.nome}; ${i.unidade}; anos ${i.anos.join(',')}; SNIS ${i.snis.join(' / ')}; SINISA ${i.sinisa.join(' / ')}. ${i.descricao}`).join('\n');
}
