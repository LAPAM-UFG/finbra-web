/**
 * Testes do Worker da IA sem chamar a API: forma do histórico (validar), esquemas das ferramentas e
 * montagem das instruções por painel.
 *
 * Uso (em worker/):  npm test
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import { FERRAMENTAS, SEM_ESTRITO, gramaticaGrande, rotaIa, validar } from '../src/ia.js';
import { acesso, destinoSeguro } from '../src/acesso.js';
import { podeConferir } from '../src/conferencia.js';
import { limparResumo, rotaConversas } from '../src/conversas.js';
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

describe('acesso à IA', () => {
  const url = new URL('https://finbra-web.exemplo.dev/api/ia/entrar');
  test('depois do login volta para a aba da IA com os filtros, nunca para outro site', () => {
    assert.equal(destinoSeguro('/ia?uf=GO&ano=2026&paineis=trabalho', url), 'https://finbra-web.exemplo.dev/ia?uf=GO&ano=2026&paineis=trabalho');
    assert.equal(destinoSeguro('/ia', url), 'https://finbra-web.exemplo.dev/ia');
    for (const ruim of ['https://outro.site/ia', '//outro.site/ia', '/iaa', '/ia\@outro', '/ia\r\nLocation: x', null, '/despesas']) {
      assert.equal(destinoSeguro(ruim, url), 'https://finbra-web.exemplo.dev/ia', String(ruim));
    }
  });
  test('sem token: motivo sem_login; no computador local, o e-mail de desenvolvimento', async () => {
    const pedido = (host) => new Request(`https://${host}/api/ia/estado`);
    assert.deepEqual(await acesso(pedido('finbra-web.exemplo.dev'), { ACCESS_TEAM: 'x', ACCESS_AUD: 'y' }), { email: null, motivo: 'sem_login', emailNegado: null });
    assert.deepEqual(await acesso(pedido('localhost'), { IA_DEV_EMAIL: 'dev@exemplo.org' }), { email: 'dev@exemplo.org', motivo: null });
  });
  test('instruções: tabelas municipais, razão dos totais × média das razões, cobertura, chaves do cruzamento e códigos executados', () => {
    const texto = instrucoes(['financas', 'trabalho'], { manifesto: null, contextoTrabalho: null }).map((b) => b.text).join('\n');
    assert.match(texto, /nunca diga que ela não cabe/);
    assert.match(texto, /média ou a mediana das razões/);
    assert.match(texto, /lacuna da declaração, não zero/);
    assert.match(texto, /confira a chave .* a unicidade .* e as perdas do cruzamento/);
    assert.match(texto, /exatamente a do filtro executado/);
    assert.match(texto, /despesa_saude_liquidada, despesa_saude_paga/);
    assert.match(texto, /mesmo intervalo do ano anterior/);
    assert.match(texto, /Códigos mais amplos que o pedido: .*superestima o recorte pedido\. Faça isso mesmo quando a pessoa der os códigos/);
  });
});

describe('conferência pelo especialista RAIS (pode_conferir)', () => {
  const LISTA = 'luanviniciusbernardelli@gmail.com, camilapbernardelli@gmail.com';
  // R2 vazio: o estado só lê a contagem do dia
  const dados = { get: async () => null };
  const estado = async (host, env) => {
    const url = new URL(`https://${host}/api/ia/estado`);
    const r = await rotaIa(new Request(url), { DADOS: dados, CONFERENCIA_EMAILS: LISTA, ...env }, url);
    return { status: r.status, corpo: await r.json() };
  };

  test('e-mail autorizado: true, sem diferença de maiúsculas nem espaços', async () => {
    const { status, corpo } = await estado('localhost', { IA_DEV_EMAIL: 'camilapbernardelli@gmail.com' });
    assert.equal(status, 200);
    assert.equal(corpo.pode_conferir, true);
    // o resto do estado continua igual
    assert.equal(corpo.email, 'camilapbernardelli@gmail.com');
    assert.equal(corpo.restantes, 50);
    assert.equal(podeConferir(' LuanViniciusBernardelli@Gmail.com ', { CONFERENCIA_EMAILS: LISTA }), true);
  });

  test('e-mail com login na IA, mas fora da lista: false', async () => {
    const { status, corpo } = await estado('localhost', { IA_DEV_EMAIL: 'outra.pessoa@ufg.br' });
    assert.equal(status, 200);
    assert.equal(corpo.pode_conferir, false);
    assert.equal(corpo.email, 'outra.pessoa@ufg.br');
    // um trecho do e-mail não basta
    assert.equal(podeConferir('bernardelli@gmail.com', { CONFERENCIA_EMAILS: LISTA }), false);
  });

  test('sem CONFERENCIA_EMAILS: todos com acesso à IA podem pedir', async () => {
    for (const vazia of [undefined, '', '  ']) {
      const { status, corpo } = await estado('localhost', { IA_DEV_EMAIL: 'outra.pessoa@ufg.br', CONFERENCIA_EMAILS: vazia });
      assert.equal(status, 200);
      assert.equal(corpo.pode_conferir, true, String(vazia));
    }
    assert.equal(podeConferir(null, {}), false);
  });

  test('sem login: 401 como antes, com pode_conferir false', async () => {
    const { status, corpo } = await estado('finbra-web.exemplo.dev', { ACCESS_TEAM: 'x.cloudflareaccess.com', ACCESS_AUD: 'y' });
    assert.equal(status, 401);
    assert.equal(corpo.codigo, 'sem_login');
    assert.equal(corpo.pode_conferir, false);
    assert.equal(podeConferir(null, { CONFERENCIA_EMAILS: LISTA }), false);
    const semLista = await estado('finbra-web.exemplo.dev', { ACCESS_TEAM: 'x.cloudflareaccess.com', ACCESS_AUD: 'y', CONFERENCIA_EMAILS: undefined });
    assert.deepEqual([semLista.status, semLista.corpo.pode_conferir], [401, false]);
    // as outras rotas sem login não mudam
    const url = new URL('https://finbra-web.exemplo.dev/api/ia');
    const r = await rotaIa(new Request(url, { method: 'POST', body: '{}' }), { DADOS: dados, ACCESS_TEAM: 'x', ACCESS_AUD: 'y' }, url);
    assert.deepEqual(await r.json(), { erro: 'login necessário', codigo: 'sem_login' });
  });
});

describe('conversas na conta', () => {
  // R2 em memória com o que conversas.js usa: get/put (com onlyIf.etagMatches), delete e list com metadados
  const r2 = () => {
    const m = new Map();
    let n = 0;
    const objeto = (v) => ({ etag: v.etag, body: v.valor, json: async () => JSON.parse(v.valor) });
    return {
      m,
      get: async (k) => (m.has(k) ? objeto(m.get(k)) : null),
      put: async (k, valor, o = {}) => {
        if (o.onlyIf?.etagMatches && m.get(k)?.etag !== o.onlyIf.etagMatches) return null;
        m.set(k, { valor: String(valor), etag: `e${++n}`, customMetadata: o.customMetadata });
        return { etag: `e${n}` };
      },
      delete: async (k) => void m.delete(k),
      list: async ({ prefix }) => ({
        objects: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, customMetadata: v.customMetadata })),
        truncated: false,
      }),
    };
  };
  const ID = '6f1c2a3b-0000-4000-8000-000000000001';
  const conversa = (id = ID, titulo = 'Vínculos em Goiás') => ({ formato: 'lapam-ia-conversa', versao: 1, id, titulo, mensagens: [], metas: [], resultados: {}, conta: 'a@x.org' });
  const resumo = (id = ID, titulo = 'Vínculos em Goiás') => ({ id, titulo, criadaEm: 1, atualizadaEm: 2, perguntas: 1, paineis: ['trabalho'], territorio: 'Goiás', modo: 'rápida', dados: ['d'], origem: { tipo: 'nova' }, busca: 'vinculos em goias' });
  const pedir = (env, email, metodo, caminho, corpo, origem) => rotaConversas(new Request(`https://site.exemplo${caminho}`, {
    method: metodo, ...(corpo ? { body: JSON.stringify(corpo) } : {}), headers: origem ? { Origin: origem } : {},
  }), env, new URL(`https://site.exemplo${caminho}`), email);

  test('grava, lista e abre só para a mesma pessoa', async () => {
    const env = { DADOS: r2() };
    assert.equal((await pedir(env, 'a@x.org', 'PUT', `/api/ia/conversas/${ID}`, { conversa: conversa(), resumo: resumo() })).status, 200);
    const lista = await (await pedir(env, 'a@x.org', 'GET', '/api/ia/conversas')).json();
    assert.deepEqual(lista.resumos.map((r) => [r.id, r.titulo, r.busca]), [[ID, 'Vínculos em Goiás', 'vinculos em goias']]);
    assert.equal((await (await pedir(env, 'a@x.org', 'GET', `/api/ia/conversas/${ID}`)).json()).titulo, 'Vínculos em Goiás');
    // outra pessoa logada não vê nem abre
    assert.deepEqual((await (await pedir(env, 'b@x.org', 'GET', '/api/ia/conversas')).json()).resumos, []);
    assert.equal((await pedir(env, 'b@x.org', 'GET', `/api/ia/conversas/${ID}`)).status, 404);
    // o e-mail não aparece nas chaves
    assert.ok([...env.DADOS.m.keys()].every((k) => /^ia\/conversas\/[0-9a-f]{64}\//.test(k) && !k.includes('x.org')));
  });

  test('a última gravação vale e excluir apaga de vez', async () => {
    const env = { DADOS: r2() };
    await pedir(env, 'a@x.org', 'PUT', `/api/ia/conversas/${ID}`, { conversa: conversa(), resumo: resumo() });
    await pedir(env, 'a@x.org', 'PUT', `/api/ia/conversas/${ID}`, { conversa: conversa(ID, 'Outro título'), resumo: resumo(ID, 'Outro título') });
    assert.deepEqual((await (await pedir(env, 'a@x.org', 'GET', '/api/ia/conversas')).json()).resumos.map((r) => r.titulo), ['Outro título']);
    assert.equal((await pedir(env, 'a@x.org', 'DELETE', `/api/ia/conversas/${ID}`)).status, 200);
    assert.equal((await pedir(env, 'a@x.org', 'GET', `/api/ia/conversas/${ID}`)).status, 404);
    assert.deepEqual((await (await pedir(env, 'a@x.org', 'GET', '/api/ia/conversas')).json()).resumos, []);
  });

  test('a lista recupera do metadado uma conversa que o índice perdeu', async () => {
    const env = { DADOS: r2() };
    const outro = '6f1c2a3b-0000-4000-8000-000000000002';
    await pedir(env, 'a@x.org', 'PUT', `/api/ia/conversas/${ID}`, { conversa: conversa(), resumo: resumo() });
    await pedir(env, 'a@x.org', 'PUT', `/api/ia/conversas/${outro}`, { conversa: conversa(outro, 'Segunda'), resumo: resumo(outro, 'Segunda') });
    // simula duas abas gravando o índice ao mesmo tempo: a segunda entrada se perdeu
    const indice = [...env.DADOS.m.keys()].find((k) => k.endsWith('/indice.json'));
    await env.DADOS.put(indice, JSON.stringify([resumo()]));
    const lista = (await (await pedir(env, 'a@x.org', 'GET', '/api/ia/conversas')).json()).resumos;
    assert.deepEqual(lista.map((r) => r.titulo).sort(), ['Segunda', 'Vínculos em Goiás']);
  });

  test('recusa identificador, conversa ou origem inválidos', async () => {
    const env = { DADOS: r2() };
    assert.equal((await pedir(env, 'a@x.org', 'PUT', '/api/ia/conversas/x', { conversa: conversa(), resumo: resumo() })).status, 400);
    assert.equal((await pedir(env, 'a@x.org', 'PUT', `/api/ia/conversas/${ID}`, { conversa: conversa('6f1c2a3b-0000-4000-8000-000000000009'), resumo: resumo() })).status, 400);
    assert.equal((await pedir(env, 'a@x.org', 'PUT', `/api/ia/conversas/${ID}`, { conversa: { ...conversa(), formato: 'outro' }, resumo: resumo() })).status, 400);
    assert.equal((await pedir(env, 'a@x.org', 'DELETE', `/api/ia/conversas/${ID}`, null, 'https://malicioso.exemplo')).status, 403);
    assert.equal((await pedir(env, 'a@x.org', 'PUT', `/api/ia/conversas/${ID}`, { conversa: conversa(), resumo: resumo() }, 'https://site.exemplo')).status, 200);
    // no computador local, o Vite (5180) repassa ao Worker (8787); localhost só vale com o Worker em localhost
    const local = (origem) => rotaConversas(new Request(`http://localhost:8787/api/ia/conversas/${ID}`, { method: 'DELETE', headers: { Origin: origem } }),
      env, new URL(`http://localhost:8787/api/ia/conversas/${ID}`), 'a@x.org');
    assert.equal((await local('http://localhost:5180')).status, 200);
    assert.equal((await pedir(env, 'a@x.org', 'DELETE', `/api/ia/conversas/${ID}`, null, 'http://localhost:5180')).status, 403);
  });

  test('o resumo guardado tem só os campos da lista, com tamanho limitado', () => {
    const r = limparResumo({ ...resumo(), busca: 'x'.repeat(50_000), extra: 'não', titulo: 't'.repeat(1000) }, ID);
    assert.equal(r.busca.length, 20_000);
    assert.equal(r.titulo.length, 300);
    assert.equal('extra' in r, false);
    assert.equal(limparResumo(resumo(), 'outro-id-qualquer'), null);
  });
});
