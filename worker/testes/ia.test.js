/**
 * Testes do Worker da IA sem chamar a API: forma do histórico (validar), esquemas das ferramentas e
 * montagem das instruções por painel.
 *
 * Uso (em worker/):  npm test
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { FERRAMENTAS, SEM_ESTRITO, gramaticaGrande, validar } from '../src/ia.js';
import { instrucoes, paineisDoPedido } from '../src/sistema_geral.js';
import { contextoDosDados } from '../src/sistema.js';

const contexto = { type: 'text', text: 'Contexto da página nesta pergunta:\n- Território selecionado: Goiás (UF GO; código IBGE 52).' };
const pergunta = (texto, antes = []) => ({ role: 'user', content: [...antes, contexto, { type: 'text', text: texto }] });
const resposta = (id) => ({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'responder', input: {} }] });

describe('histórico da conversa', () => {
  test('aceita a pergunta como texto simples ou como blocos (contexto + pergunta)', () => {
    assert.equal(validar([{ role: 'user', content: 'Quantos vínculos?' }]), null);
    assert.equal(validar([pergunta('Quantos vínculos?')]), null);
  });

  test('segunda pergunta leva o resultado pendente da ferramenta responder', () => {
    const hist = [
      pergunta('Quantos vínculos em 2024?'),
      resposta('r1'),
      pergunta('E em 2025?', [{ type: 'tool_result', tool_use_id: 'r1', content: 'Resposta exibida ao usuário.' }]),
    ];
    assert.equal(validar(hist), null);
  });

  test('mensagem só com resultados de consulta não é pergunta', () => {
    assert.match(validar([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '{}' }] }]), /começar por uma pergunta/);
  });

  test('recusa pergunta vazia, longa demais ou com contexto longo demais', () => {
    assert.match(validar([pergunta('   ')]), /vazia/);
    assert.match(validar([pergunta('x'.repeat(2001))]), /2000/);
    const longo = { role: 'user', content: [{ type: 'text', text: 'c'.repeat(1501) }, { type: 'text', text: 'Quantos vínculos?' }] };
    assert.match(validar([longo]), /2000/);
  });

  test('recusa blocos sem tipo e histórico que termina no assistente', () => {
    assert.match(validar([{ role: 'user', content: [{ text: 'sem tipo' }] }]), /inválido/);
    assert.match(validar([pergunta('Quantos?'), resposta('r1')]), /última mensagem/);
  });
});

describe('ferramentas', () => {
  /** No modo estrito, todo objeto precisa de additionalProperties: false e de todos os campos em required. */
  function conferirEstrito(esquema, caminho) {
    if (esquema.type === 'object') {
      assert.equal(esquema.additionalProperties, false, `${caminho}: additionalProperties`);
      assert.deepEqual([...esquema.required].sort(), Object.keys(esquema.properties).sort(), `${caminho}: required`);
      for (const [k, v] of Object.entries(esquema.properties)) conferirEstrito(v, `${caminho}.${k}`);
    }
    if (esquema.type === 'array') conferirEstrito(esquema.items, `${caminho}[]`);
    for (const proibida of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
      assert.ok(!(proibida in esquema), `${caminho}: ${proibida} não é aceito no modo estrito`);
    }
  }

  test('só responder é estrita; esquemas válidos e sem enum (gramática dentro do limite da API)', () => {
    assert.deepEqual(FERRAMENTAS.map((f) => f.name), ['consultar', 'localizar', 'responder']);
    // com as três estritas, ou com enum, a API recusou o pedido: "The compiled grammar is too large"
    assert.deepEqual(FERRAMENTAS.map((f) => f.strict), [false, false, true]);
    for (const f of FERRAMENTAS) {
      conferirEstrito(f.input_schema, f.name);
      assert.doesNotMatch(JSON.stringify(f.input_schema), /"enum"/, `${f.name}: enum`);
    }
  });

  test('gramática grande demais: repete com as mesmas ferramentas, sem modo estrito', () => {
    assert.deepEqual(SEM_ESTRITO.map((f) => f.strict), [false, false, false]);
    assert.deepEqual(SEM_ESTRITO.map((f) => f.input_schema), FERRAMENTAS.map((f) => f.input_schema));
    const recusa = (texto) => new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: texto } }, texto, new Headers());
    assert.ok(gramaticaGrande(recusa('The compiled grammar is too large, which would cause performance issues.')));
    assert.ok(!gramaticaGrande(recusa('messages: field required')));
    assert.ok(!gramaticaGrande(new Error('The compiled grammar is too large')));
  });

  test('destaques levam o período (de, ate); leituras levam a consulta e as colunas de apoio', () => {
    const resposta = FERRAMENTAS.find((f) => f.name === 'responder').input_schema.properties.resposta.properties;
    assert.deepEqual(Object.keys(resposta.destaques.items.properties).filter((k) => k === 'de' || k === 'ate'), ['de', 'ate']);
    assert.equal(resposta.interpretacao.type, 'array');
    assert.deepEqual(resposta.interpretacao.items.required, ['texto', 'consulta', 'colunas']);
    assert.ok('substitui' in FERRAMENTAS[0].input_schema.properties, 'consultar registra a consulta que refaz');
  });

  test('tabelas: consulta, forma e períodos pedidos; recorte com período solicitado e agrupamentos', () => {
    const resposta = FERRAMENTAS.find((f) => f.name === 'responder').input_schema.properties.resposta.properties;
    const tabela = resposta.tabelas.items.properties;
    assert.match(tabela.tipo.description, /serie.*comparacao.*tabela/);
    assert.match(tabela.papel.description, /principal.*alternativa.*complemento/);
    for (const k of ['consulta', 'grupo', 'periodo', 'valor', 'de', 'ate', 'total', 'participacao', 'unidade']) assert.ok(k in tabela, k);
    for (const k of ['periodo_solicitado', 'periodo', 'agrupamentos']) assert.ok(k in resposta.recorte.properties, k);
  });

  test('modos e regras de tabela, período pedido e fórmulas nas instruções', () => {
    const texto = instrucoes(['trabalho'], { manifesto: null, contextoTrabalho: {} }).map((b) => b.text).join('\n');
    assert.match(texto, /## Modos/);
    assert.match(texto, /rápida: [^\n]*inclua a tabela com esses dados \(tabelas\) também neste modo/);
    assert.match(texto, /pesquisa: a tabela completa é o centro da resposta/);
    assert.match(texto, /"de 2011 a 2021" pede todos os anos do intervalo/);
    assert.match(texto, /só como tabela de papel "alternativa"/);
    assert.match(texto, /"nominal" e "real" só para valores em reais/);
    assert.match(texto, /variação percentual = \(final \/ inicial − 1\) × 100, só com valor inicial positivo/);
    assert.doesNotMatch(texto, /## Estilo/);
  });
});

describe('regras que evitam os erros da conversa de Andirá (PR)', () => {
  const trabalho = instrucoes(['trabalho'], { manifesto: null, contextoTrabalho: {} }).map((b) => b.text).join('\n');

  test('códigos: trab_caged usa cod_ibge de 7 dígitos; só rais_mun e rais_vinculos usam 6', () => {
    // a regra antiga ("município da RAIS/CAGED tem 6 dígitos") levou a 410110 em trab_caged, com 0 linhas
    assert.doesNotMatch(trabalho, /RAIS\/CAGED tem 6 dígitos/);
    assert.match(trabalho, /cod_ibge, 7 dígitos[^\n]*trab_caged/);
    assert.match(trabalho, /municipio, 6 dígitos[^\n]*só em rais_mun e rais_vinculos/);
    assert.match(trabalho, /chame localizar/);
  });

  test('quebra de série vai na conclusão; leituras e hipóteses só com base; competência como set/2025', () => {
    assert.match(trabalho, /diga isso na própria conclusão, junto ao número/);
    assert.match(trabalho, /Nada de adjetivos comparativos/);
    assert.match(trabalho, /descrições de nível, distribuição, ranking ou evolução não levam hipóteses/);
    assert.match(trabalho, /set\/2025, nunca 202509/);
    assert.match(trabalho, /trab_grandes_setores/);
  });
});

describe('instruções', () => {
  test('cada painel leva só a própria seção; cruzamento só com mais de um', () => {
    const so = (p) => instrucoes(p, { manifesto: null, contextoTrabalho: {} }).map((b) => b.text).join('\n');
    const trabalho = so(['trabalho']);
    assert.match(trabalho, /# Painel de mercado de trabalho/);
    assert.doesNotMatch(trabalho, /# Painel de finanças públicas/);
    assert.doesNotMatch(trabalho, /# Cruzando painéis/);
    assert.match(trabalho, /ferramenta responder/);
    assert.match(trabalho, /Quebra de série da RAIS/);
    assert.match(so(['financas', 'trabalho']), /# Cruzando painéis/);
  });

  test('o bloco fixo fica em cache e vem antes dos dados variáveis', () => {
    const blocos = instrucoes(['trabalho'], { manifesto: null, contextoTrabalho: { rais_anos: [2024, 2025] } });
    assert.deepEqual(blocos[0].cache_control, { type: 'ephemeral' });
    assert.match(blocos.at(-1).text, /2024, 2025/);
  });

  test('SIOPE e SIOPS só entram nas instruções quando publicados; remuneração só com meses', () => {
    const base = { gerado_em: 'x', anos: [2013, 2025], base_ipca: 2025, fontes: {} };
    assert.doesNotMatch(contextoDosDados(base), /siope_|siops_/);
    const com = contextoDosDados({ ...base, fontes: { siope: { anos: [2013, 2025], remuneracao: [] }, siops: { anos: [2013, 2025] } } });
    assert.match(com, /siope_indicadores/);
    assert.match(com, /siops_indicadores/);
    assert.doesNotMatch(com, /siope_remuneracao/);
    assert.match(contextoDosDados({ ...base, fontes: { siope: { anos: [2024], remuneracao: [202412] } } }), /siope_remuneracao[\s\S]*Meses: 12\/2024/);
  });

  test('painéis desconhecidos são ignorados; nenhum válido = todos', () => {
    assert.deepEqual(paineisDoPedido(['trabalho', 'x']), ['trabalho']);
    assert.deepEqual(paineisDoPedido([]), ['financas', 'trabalho']);
    assert.deepEqual(paineisDoPedido('trabalho'), ['financas', 'trabalho']);
  });
});
