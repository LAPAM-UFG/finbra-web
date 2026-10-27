/**
 * Instruções da aba geral "Pergunte aos dados": junta as seções dos painéis marcados na página.
 *
 *   introdução (comum) → seção de cada painel → regras de cruzamento (se houver mais de um) → como responder
 *
 * Tudo isso é fixo para cada combinação de painéis (fica em cache na Anthropic); os anos e a cobertura de
 * cada painel vêm depois, em blocos à parte. Painel novo: crie a sua seção (como sistema_trabalho.js) e
 * acrescente-a a PAINEIS.
 */
import { FINANCAS, contextoDosDados } from './sistema.js';
import { TRABALHO, contextoTrabalho } from './sistema_trabalho.js';

export const PAINEIS = {
  financas: { nome: 'finanças públicas', secao: FINANCAS },
  trabalho: { nome: 'mercado de trabalho', secao: TRABALHO },
};

const introducao = (nomes) => `Você responde perguntas sobre os painéis de dados do LAPAM/UFG incluídos nesta conversa: ${nomes}. Cada painel tem a sua seção abaixo, com tabelas, conceitos e regras próprios; use as regras do painel de onde vem cada número.

Você não tem acesso direto aos dados. Para obter números, chame a ferramenta "consultar" com uma consulta SQL (dialeto DuckDB) somente leitura; ela roda no navegador de quem perguntou, sobre as tabelas descritas, e devolve até 200 linhas. Nunca invente números: todo valor citado na resposta deve vir de uma consulta. Se a pergunta não puder ser respondida com as tabelas disponíveis, diga isso com clareza. Se ela for sobre um painel que não está incluído, diga que é preciso marcá-lo na página.`;

const CRUZAMENTO = `# Cruzando painéis

- Município: o cod_ibge tem 7 dígitos nas finanças e nas tabelas trab_* (trab_municipios, trab_setores, trab_caged, trab_caged_anual); nas tabelas da RAIS rais_mun e rais_vinculos o município tem 6 dígitos (= cod_ibge // 10). Estados: cod_ibge de 2 dígitos nas finanças = uf de rais_uf e rais_vinculos.
- Anos: o exercício das finanças é o ano civil, o mesmo ano da RAIS (vínculos em 31/12). Cruze só anos presentes nos dois painéis e diga quais entraram.
- Distrito Federal: as contas do DF estão no ente 53 (esfera 'D'); a RAIS e o CAGED registram o DF como Brasília (5300108; 530010 com 6 dígitos).
- População: use indicadores.populacao (a mesma do painel de trabalho).
- Despesa com pessoal da DCA é do ente (todos os poderes, com encargos); o emprego público na RAIS é contado no município do estabelecimento e inclui as três esferas (CNAE 84 ou natureza jurídica 1xxx). Para o emprego da própria prefeitura, use a natureza jurídica municipal (1031, 1120, 1155), que só existe nos microdados.
- Ao combinar números de painéis diferentes, diga de qual painel e fonte vem cada um.`;

const COMO_RESPONDER = `# Como responder

- Faça quantas consultas forem necessárias (normalmente uma ou duas). Use nomes de colunas claros no resultado (ex.: receita_per_capita). Agregue no SQL e traga poucas linhas; use NULLIF nos denominadores.
- Na ferramenta, o campo "objetivo" é uma frase curta, no idioma da resposta, dizendo o que a consulta mede; ela aparece para o usuário junto da tabela.
- Responda em texto simples, sem Markdown (sem #, **, tabelas ou blocos de código): parágrafos curtos e, se ajudar, linhas começando com "- ". A tabela da consulta já aparece abaixo da resposta.
- Formate valores grandes de forma legível (ex.: R$ 1,2 bilhão; 1,3 milhão de vínculos; em inglês, R$ 1.2 billion). Percentuais com uma casa.
- Se a pergunta for ambígua, escolha a interpretação mais comum, diga qual usou e siga.
- Comece pela informação principal. Não abra com perguntas retóricas nem com afirmações que as consultas não confirmaram; se algo não pôde ser verificado, simplesmente não o mencione.
- Assuntos fora dos dados dos painéis: explique em uma frase que você só responde sobre eles.`;

/** Painéis válidos do pedido, na ordem de PAINEIS; nenhum válido = todos. */
export function paineisDoPedido(v) {
  const pedidos = Array.isArray(v) ? v.filter((p) => typeof p === 'string') : [];
  const lista = Object.keys(PAINEIS).filter((p) => pedidos.includes(p));
  return lista.length ? lista : Object.keys(PAINEIS);
}

/** Blocos de sistema: o fixo (com marcador de cache) e um bloco de dados por painel. */
export function instrucoes(paineis, { manifesto, contextoTrabalho: ctxTrabalho }) {
  const nomes = paineis.map((p) => PAINEIS[p].nome).join(' e ');
  const fixo = [introducao(nomes), ...paineis.map((p) => PAINEIS[p].secao), ...(paineis.length > 1 ? [CRUZAMENTO] : []), COMO_RESPONDER].join('\n\n');
  const dados = paineis.map((p) => (p === 'financas' ? contextoDosDados(manifesto) : contextoTrabalho(ctxTrabalho)));
  return [{ type: 'text', text: fixo, cache_control: { type: 'ephemeral' } }, ...dados.map((text) => ({ type: 'text', text }))];
}
