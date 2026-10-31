/**
 * Perguntas à base com o Claude (/api/ia). Só com login no Cloudflare Access.
 *
 * O Worker não roda SQL: o Claude propõe consultas (ferramenta "consultar"), o navegador as executa
 * no DuckDB com os mesmos Parquet do painel e devolve o resultado no próximo pedido; lugares citados pelo
 * nome passam pela ferramenta "localizar" (cadastro de entes, também no navegador). A resposta final vem
 * pela ferramenta "responder" (conclusão, destaques, tabelas, gráficos, ressalvas), que a página confere com os
 * resultados das consultas antes de mostrar (o que não bate volta ao modelo). O histórico da conversa
 * fica no navegador e vem inteiro a cada pedido (a API não guarda estado).
 *
 *   GET  /api/ia/estado   e-mail, perguntas restantes no dia e se pode pedir conferência (conferencia.js)
 *   GET  /api/ia/entrar   passa pelo login do Access e volta para /ia
 *   POST /api/ia          { idioma, mensagens, paineis?, contexto?, manifesto? } -> { conteudo, parada, restantes }
 *   /api/ia/conversas*    histórico das conversas na conta (conversas.js)
 *
 * Uma IA para todos os painéis (aba "Pergunte aos dados"): paineis diz quais entram na conversa
 * (['financas', 'trabalho']; vazio = todos) e as instruções juntam a seção de cada um (sistema_geral.js).
 * contexto: anos e microdados do mercado de trabalho, informados pelo navegador.
 * Cada pergunta é uma mensagem do usuário com blocos de texto: o contexto da página (território, ano de
 * referência, estilo de resposta) e, por último, a pergunta; antes deles, os resultados de ferramenta que a
 * resposta anterior deixou pendentes (a chamada de "responder").
 *
 * Limites por pessoa e dia (horário de Brasília): 50 perguntas e 400 chamadas ao modelo (cada pergunta
 * pode levar algumas rodadas de consulta). A contagem fica no R2, em ia/uso/, fora de /dados/.
 * Segredo: ANTHROPIC_API_KEY (wrangler secret put ANTHROPIC_API_KEY).
 */
import Anthropic from '@anthropic-ai/sdk';
import { acesso, destinoSeguro } from './acesso.js';
import { podeConferir } from './conferencia.js';
import { rotaConversas } from './conversas.js';
import { instrucoes, paineisDoPedido } from './sistema_geral.js';

// Modelo: IA_MODELO (variável do Worker ou worker/.dev.vars), entre os da lista; padrão Haiku, o mais barato
// (cerca de 1/20 do Sonnet). O Sonnet segue melhor as regras dos painéis (ex.: descartar "exceto …" na busca de
// códigos). Com Sonnet ou Opus dá para pedir o modelo reserva (betas ['server-side-fallback-2026-07-01'],
// fallbacks: 'default'), que o Haiku não tem
const MODELOS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
const modeloDe = (env) => (MODELOS.includes(env.IA_MODELO?.trim()) ? env.IA_MODELO.trim() : MODELOS[0]);
const LIMITE_PERGUNTAS = 50;
const LIMITE_CHAMADAS = 400;
const MAX_RODADAS = 12; // chamadas ao modelo por pergunta
// tokens de saída por chamada (pensamento + resposta): o máximo do Haiku 5.5, para análises longas não serem
// cortadas; paga-se só o que o modelo escreve. Acima de ~16 mil a chamada precisa ser por streaming
const MAX_SAIDA = 128_000;
const MAX_PERGUNTAS_CONVERSA = 15;
const MAX_CORPO = 600_000; // bytes
const MAX_PERGUNTA = 2000; // caracteres
const MAX_CONTEXTO = 1500; // caracteres do contexto da página que acompanha cada pergunta

// sem enum nos esquemas: com eles e as tabelas, a gramática do modo estrito passa do limite da API; a página
// normaliza os valores (lerResposta)
const FORMATO = '"inteiro", "decimal", "reais" ou "percentual" (0–100).';

export const FERRAMENTAS = [
  {
    name: 'consultar',
    description:
      'Executa uma consulta SQL somente leitura (DuckDB) nas tabelas descritas nas instruções, no navegador '
      + 'de quem perguntou. Devolve o identificador da consulta (C1, C2…, para citar em "responder"), as colunas e até '
      + '200 linhas em JSON, com o total de linhas. Use para obter qualquer número da resposta. '
      + 'Só SELECT ou WITH, uma instrução, sem ler arquivos ou URLs. Antes de rodar, a página confere os códigos de '
      + 'município e UF da consulta e recusa (erro "bloqueada") código no formato errado, inexistente ou buscado por aproximação.',
    // só responder é estrita: com as três, a gramática do modo estrito passa do limite da API (a página confere
    // a entrada de consultar e localizar antes de usá-la)
    strict: false,
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Uma única consulta SELECT/WITH em SQL do DuckDB.' },
        objetivo: { type: 'string', description: 'Frase curta, no idioma da resposta, dizendo o que a consulta mede.' },
        substitui: { type: 'string', description: 'Identificador da consulta que esta corrige ou refaz (ex.: C4), ou "" se for nova.' },
        colunas: {
          type: 'array',
          description: 'Unidade de cada coluna do resultado, na ordem do SELECT; a página formata por ela (não pelo nome). '
            + 'unidade: "reais", "reais_por_habitante", "contagem" (municípios, vínculos, pessoas: inteiros), "habitantes", '
            + '"percentual" (0–100), "pontos_percentuais", "razao", "estatistica" (correlação, R², t, p), "indice" (deflator, número-índice), '
            + '"codigo" (código IBGE, CNAE, CBO), "ano", "competencia" ou "texto". rotulo: cabeçalho legível, com acentos e unidade '
            + '(ex.: "Despesa da função 04 por habitante (R$ de 2025)"), ou "". nulo: o que um valor nulo da coluna significa — '
            + '"ausente" (padrão: dado que falta), "nao_aplicavel", "denominador_invalido" (razão com denominador nulo ou zero, '
            + 'ex.: per capita sem população), "suprimido" ou "nao_calculado".',
          items: {
            type: 'object',
            properties: { nome: { type: 'string' }, unidade: { type: 'string' }, rotulo: { type: 'string' }, nulo: { type: 'string' } },
            required: ['nome', 'unidade', 'rotulo', 'nulo'],
            additionalProperties: false,
          },
        },
        regressao: {
          type: 'object',
          description: 'Só para regressão linear: a página roda a consulta inteira (uma linha por observação, até 20 mil) e estima por '
            + 'MQO; o resultado desta consulta passa a ser a tabela de coeficientes (termo, coeficiente, erro_padrao, estatistica_t, '
            + 'p_valor, ic95_inferior, ic95_superior, n_observacoes, r2, r2_ajustado, graus_liberdade, descartadas_por_ausencia, '
            + 'tipo_erro_padrao, distribuicao). y e x são colunas do resultado; erro_padrao: "hc1" (robusto, padrão) ou "classico". '
            + 'Nas consultas comuns: {"y": "", "x": [], "erro_padrao": ""}.',
          properties: {
            y: { type: 'string' },
            x: { type: 'array', items: { type: 'string' } },
            erro_padrao: { type: 'string' },
          },
          required: ['y', 'x', 'erro_padrao'],
          additionalProperties: false,
        },
        verificacao: {
          type: 'object',
          description: 'Verificações que a página roda junto com a consulta e devolve em "verificacao_da_pagina" (números do DuckDB). '
            + 'chaves: colunas do próprio resultado que deveriam identificar uma linha dele (ex.: cod_ibge numa tabela por município; '
            + '[] numa consulta agregada); a página conta linhas e combinações distintas. '
            + 'juncoes: para cada junção, esquerda e direita são SELECTs que devolvem as colunas-chave de cada lado, com os mesmos nomes '
            + '(ex.: SELECT cod_ibge FROM indicadores WHERE exercicio = 2025 AND uf = \'GO\'); a página conta linhas, chaves distintas, '
            + 'cardinalidade (1:1, 1:N, N:1, N:N) e chaves sem correspondência, com exemplos. amostra: etapas em ordem, cada uma um SELECT '
            + 'que devolve uma contagem (quantos entes antes e depois de cada filtro). Obrigatório ao juntar tabelas de fontes diferentes '
            + '(ex.: DCA e RAIS). Sem verificações: {"chaves": [], "juncoes": [], "amostra": []}.',
          properties: {
            chaves: { type: 'array', items: { type: 'string' } },
            juncoes: {
              type: 'array',
              items: {
                type: 'object',
                properties: { rotulo: { type: 'string' }, esquerda: { type: 'string' }, direita: { type: 'string' }, chaves: { type: 'array', items: { type: 'string' } } },
                required: ['rotulo', 'esquerda', 'direita', 'chaves'],
                additionalProperties: false,
              },
            },
            amostra: {
              type: 'array',
              items: {
                type: 'object',
                properties: { etapa: { type: 'string' }, sql: { type: 'string' } },
                required: ['etapa', 'sql'],
                additionalProperties: false,
              },
            },
          },
          required: ['chaves', 'juncoes', 'amostra'],
          additionalProperties: false,
        },
      },
      required: ['sql', 'objetivo', 'substitui', 'colunas', 'regressao', 'verificacao'],
      additionalProperties: false,
    },
  },
  {
    name: 'localizar',
    description:
      'Acha um município ou uma UF pelo nome (sem diferenciar acentos) e devolve os códigos em cada formato das tabelas: '
      + 'cod_ibge de 7 dígitos, municipio de 6 dígitos da RAIS, sigla e código da UF. Use antes de consultar um lugar '
      + 'citado na pergunta que não seja o do contexto da página; nunca procure códigos com LIKE ou por parte do código. '
      + 'Com nomes repetidos em mais de uma UF, devolve todos.',
    strict: false,
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome do município ou da UF, como na pergunta (ex.: Andirá).' },
        uf: { type: 'string', description: 'Sigla ou nome da UF, se a pergunta disser (ex.: PR), ou "".' },
      },
      required: ['nome', 'uf'],
      additionalProperties: false,
    },
  },
  {
    name: 'responder',
    description:
      'Entrega a resposta final ao usuário. Chame uma única vez, sozinha, no fim de cada pergunta, depois de ver os '
      + 'resultados das consultas; não escreva a resposta final fora desta ferramenta. Todo número vem dos resultados '
      + 'das consultas desta conversa. Todos os campos vão dentro do objeto "resposta", em JSON; os sem conteúdo ficam '
      + 'vazios ("" ou []). Nos textos, nada de marcações (como <parameter> ou </conclusao>) e acentos escritos '
      + 'diretamente (á, ç, ã), sem sequências como \\u00e1. A página confere a resposta antes de mostrá-la e devolve '
      + 'os problemas (destaque fora da tabela, tabela ou gráfico com coluna inexistente, tabela faltando quando a '
      + 'pergunta ou o modo pesquisa a pedem, anos pedidos trocados, ano indisponível sem aviso na conclusão, leitura sem '
      + 'colunas de apoio, comparação que atravessa quebra de série sem dizer isso na conclusão) para você corrigir.',
    strict: true,
    // um único parâmetro-objeto: o modelo o escreve como JSON, e os textos longos não se misturam com a
    // marcação de parâmetros da chamada (com campos de texto soltos, o Haiku às vezes fechava um campo com
    // "</conclusao>" e engolia os seguintes)
    input_schema: {
      type: 'object',
      properties: {
        resposta: {
          type: 'object',
          properties: {
            tipo: {
              type: 'string',
              description: '"resposta"; "esclarecimento" quando falta uma informação indispensável; "fora_da_cobertura" quando os dados não respondem.',
            },
            conclusao: {
              type: 'string',
              description: 'A resposta principal em 1 a 3 frases, começando pelo resultado, com os números-chave. Em "esclarecimento", a pergunta curta a fazer.',
            },
            destaques: {
              type: 'array',
              description: 'De 0 a 4 números principais; a página confere cada um na tabela da consulta indicada.',
              items: {
                type: 'object',
                properties: {
                  rotulo: { type: 'string', description: 'O que o número mede, em poucas palavras.' },
                  valor: { type: 'number', description: 'O número exato da célula do resultado, sem arredondar; percentuais na escala 0–100.' },
                  formato: { type: 'string', description: FORMATO },
                  unidade: { type: 'string', description: 'Unidade curta, sem repetir o símbolo do formato: "vínculos em 31/12", "de dez/2025 (IPCA)", "dos vínculos".' },
                  consulta: { type: 'string', description: 'Identificador da consulta de onde vem o valor (ex.: C2).' },
                  coluna: { type: 'string', description: 'Nome exato da coluna no resultado.' },
                  de: { type: 'string', description: 'Início do período do número: ano ("2015") ou competência ("2025-09").' },
                  ate: { type: 'string', description: 'Fim do período: igual a de para um único ano ou mês; numa variação, o último período comparado.' },
                },
                required: ['rotulo', 'valor', 'formato', 'unidade', 'consulta', 'coluna', 'de', 'ate'],
                additionalProperties: false,
              },
            },
            explicacao: { type: 'string', description: 'Modo rápido: dados observados que sustentam a conclusão, em itens começando com "- ". Modo pesquisa: análise dos resultados em parágrafos, ligada aos valores das tabelas.' },
            interpretacao: {
              type: 'array',
              description: 'Leituras que vão além da descrição, cada uma com a consulta e as colunas que a sustentam (o indicador e a referência da comparação); [] se não houver.',
              items: {
                type: 'object',
                properties: {
                  texto: { type: 'string' },
                  consulta: { type: 'string', description: 'Identificador da consulta (ex.: C3).' },
                  colunas: { type: 'array', items: { type: 'string' }, description: 'Colunas do resultado que sustentam a leitura.' },
                },
                required: ['texto', 'consulta', 'colunas'],
                additionalProperties: false,
              },
            },
            hipoteses: { type: 'string', description: 'Explicações possíveis que os dados não testaram, só quando a pergunta pede causas; vazio na maioria das respostas.' },
            limitacoes: { type: 'string', description: 'Ressalvas indispensáveis para ler os números: quebra de série, cobertura, ausências, grupos pequenos; vazio se não houver.' },
            recorte: {
              type: 'object',
              properties: {
                territorio: { type: 'string' },
                periodo_solicitado: { type: 'string', description: 'Período como a pergunta pediu (ex.: 2011 e 2021; 2011 a 2021).' },
                periodo: { type: 'string', description: 'Período efetivamente usado nos dados (ex.: 2021; 2013 a 2021).' },
                unidade: { type: 'string', description: 'Ex.: vínculos ativos em 31/12; R$ nominais; R$ de dez/2025 (IPCA). Nominal/real só para valores em reais.' },
                filtros: { type: 'string', description: 'Definições e filtros aplicados, ex.: vínculos ativos em 31/12; CNAE classes 01512, 10112.' },
                agrupamentos: { type: 'string', description: 'Grupos formados e o que entra em cada um, ou "".' },
              },
              required: ['territorio', 'periodo_solicitado', 'periodo', 'unidade', 'filtros', 'agrupamentos'],
              additionalProperties: false,
            },
            metodologia: { type: 'string', description: 'Tabelas usadas, fórmulas e critérios, em texto simples.' },
            tabelas: {
              type: 'array',
              description: 'Até 10 tabelas (MAX_TABELAS de web/src/ia.ts), uma para cada recorte que a pergunta pede ou que a análise cita '
                + '(ex.: sexo, natureza jurídica e municípios são três tabelas), montadas pela página com o resultado das consultas (a página faz totais, variações e '
                + 'participações). serie: uma linha por período e uma coluna por grupo; comparacao: uma linha por grupo, '
                + 'valores nos dois períodos, variação absoluta e percentual; tabela: o resultado como veio.',
              items: {
                type: 'object',
                properties: {
                  consulta: { type: 'string', description: 'Identificador da consulta (ex.: C2).' },
                  papel: { type: 'string', description: '"principal" responde ao pedido; "alternativa" usa outro recorte (ex.: anos disponíveis), sem atender ao pedido por inteiro; "complemento" apoia a leitura.' },
                  tipo: { type: 'string', description: '"serie", "comparacao" ou "tabela".' },
                  titulo: { type: 'string', description: 'Título com o que mede, onde e quando (ex.: Vínculos ativos em 31/12 por subsistema — Brasil, 2011 e 2021).' },
                  grupo: { type: 'string', description: 'Coluna dos grupos em formato longo (serie e comparacao), ou "".' },
                  periodo: { type: 'string', description: 'Coluna do ano ou da competência, ou "" na tabela sem período.' },
                  valor: { type: 'string', description: 'Coluna numérica (serie e comparacao), ou "" na tabela.' },
                  colunas: { type: 'array', items: { type: 'string' }, description: 'Na tabela: colunas mostradas, na ordem ([] = todas). Nas outras: [].' },
                  de: { type: 'string', description: 'Primeiro período pedido na pergunta (ano "2011" ou competência "2025-09"), mesmo que não esteja nos dados; "" se a pergunta não disser.' },
                  ate: { type: 'string', description: 'Último período pedido (ano ou competência), ou "".' },
                  total: { type: 'boolean', description: 'Acrescenta o total dos grupos (só quando somá-los faz sentido).' },
                  participacao: { type: 'boolean', description: 'Na comparação com total: participação de cada grupo no total de cada período.' },
                  formato: { type: 'string', description: FORMATO },
                  unidade: { type: 'string', description: 'Unidade dos valores (ex.: vínculos ativos em 31/12; R$ de dez/2025 (IPCA)).' },
                  nota: { type: 'string', description: 'Nota indispensável para ler a tabela (definição, filtro, quebra de série), ou "".' },
                },
                required: ['consulta', 'papel', 'tipo', 'titulo', 'grupo', 'periodo', 'valor', 'colunas', 'de', 'ate', 'total', 'participacao', 'formato', 'unidade', 'nota'],
                additionalProperties: false,
              },
            },
            graficos: {
              type: 'array',
              description: 'Até 2 gráficos, só quando ajudam; a página os monta com os dados da consulta indicada. x e y são colunas '
                + 'que existem nela; para comparar categorias, a consulta precisa ter uma linha por categoria.',
              items: {
                type: 'object',
                properties: {
                  consulta: { type: 'string' },
                  tipo: { type: 'string', description: '"linha" ou "barras".' },
                  titulo: { type: 'string' },
                  x: { type: 'string', description: 'Coluna dos anos ou das categorias.' },
                  y: { type: 'array', items: { type: 'string' }, description: 'Até 3 colunas numéricas.' },
                  serie: { type: 'string', description: 'Coluna que separa as séries num resultado em formato longo (ex.: uf_sigla), ou "".' },
                  formato: { type: 'string', description: FORMATO },
                },
                required: ['consulta', 'tipo', 'titulo', 'x', 'y', 'serie', 'formato'],
                additionalProperties: false,
              },
            },
            aprofundar: {
              type: 'array',
              items: { type: 'string' },
              description: 'Até 3 perguntas curtas de continuação que os dados disponíveis respondem.',
            },
          },
          required: ['tipo', 'conclusao', 'destaques', 'explicacao', 'interpretacao', 'hipoteses', 'limitacoes', 'recorte', 'metodologia', 'tabelas', 'graficos', 'aprofundar'],
          additionalProperties: false,
        },
      },
      required: ['resposta'],
      additionalProperties: false,
    },
  },
];
export const SEM_ESTRITO = FERRAMENTAS.map((f) => ({ ...f, strict: false }));
export const gramaticaGrande = (e) => e instanceof Anthropic.BadRequestError && /grammar is too large/i.test(e.message ?? '');

const IDIOMA = {
  pt: 'Responda em português do Brasil.',
  en: 'Answer in English. Keep Brazilian program and account names in Portuguese, with a short English gloss the first time.',
};

const resposta = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const erro = (mensagem, status, codigo, extra = {}) => resposta({ erro: mensagem, ...(codigo ? { codigo } : {}), ...extra }, status);

// ---------------- uso diário ----------------

const diaDeBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

async function chaveDeUso(email) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)));
  return `ia/uso/${diaDeBrasilia()}/${[...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}.json`;
}

async function lerUso(env, chave) {
  const o = await env.DADOS.get(chave);
  return o ? await o.json() : { perguntas: 0, chamadas: 0 };
}

// ---------------- manifesto (anos, ano-base, cobertura) ----------------

const manifesto = { valor: null, ate: 0 };
async function lerManifesto(env) {
  if (Date.now() > manifesto.ate) {
    const o = await env.DADOS.get('gold/manifesto.json');
    manifesto.valor = o ? await o.json() : null;
    manifesto.ate = Date.now() + 10 * 60_000;
  }
  return manifesto.valor;
}

// ---------------- validação do histórico ----------------

/** Textos de uma mensagem do usuário: a pergunta é o último; antes dele pode vir o contexto da página. */
const textos = (m) => (typeof m.content === 'string'
  ? [m.content]
  : m.content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text));
// mensagens só com resultados de ferramenta (tool_result) não são perguntas
const ehPergunta = (m) => m.role === 'user' && textos(m).length > 0;

/** Confere a forma do histórico enviado pelo navegador; devolve a mensagem de erro ou null. */
export function validar(mensagens) {
  if (!Array.isArray(mensagens) || !mensagens.length) return 'histórico vazio';
  if (!mensagens.every((m) => m && (m.role === 'user' || m.role === 'assistant')
    && (typeof m.content === 'string' || (Array.isArray(m.content) && m.content.every((b) => b && typeof b.type === 'string'))))) {
    return 'histórico inválido';
  }
  if (!ehPergunta(mensagens[0])) return 'a conversa deve começar por uma pergunta';
  const ultima = mensagens.at(-1);
  if (ultima.role !== 'user') return 'a última mensagem deve ser do usuário';
  const perguntas = mensagens.filter(ehPergunta);
  if (perguntas.length > MAX_PERGUNTAS_CONVERSA) return 'conversa longa demais: comece uma nova';
  if (perguntas.some((m) => {
    const tx = textos(m);
    const pergunta = tx.at(-1);
    return !pergunta.trim() || pergunta.length > MAX_PERGUNTA || tx.slice(0, -1).join('').length > MAX_CONTEXTO;
  })) return `pergunta vazia ou com mais de ${MAX_PERGUNTA} caracteres`;
  const inicio = mensagens.findLastIndex(ehPergunta);
  if (mensagens.slice(inicio).filter((m) => m.role === 'assistant').length >= MAX_RODADAS) return 'consultas demais nesta pergunta';
  return null;
}

// ---------------- rotas ----------------

export async function rotaIa(request, env, url) {
  const { email, motivo, emailNegado } = await acesso(request, env);
  // depois do login do Access, volta para a página de onde a pessoa saiu (com território, ano e painéis)
  if (url.pathname === '/api/ia/entrar' && (email || motivo === 'nao_autorizado')) {
    return Response.redirect(destinoSeguro(url.searchParams.get('volta'), url), 302);
  }
  // sem acesso, o estado também diz que não há conferência (o resto da resposta continua o mesmo)
  const semConferir = url.pathname === '/api/ia/estado' ? { pode_conferir: false } : {};
  if (motivo === 'nao_autorizado') return erro(`o e-mail ${emailNegado} entrou, mas não está autorizado a usar a IA`, 403, 'nao_autorizado', semConferir);
  if (!email) return erro(motivo === 'expirado' ? 'sessão expirada: entre de novo' : 'login necessário', 401, motivo === 'expirado' ? 'expirado' : 'sem_login', semConferir);

  if (url.pathname === '/api/ia/conversas' || url.pathname.startsWith('/api/ia/conversas/')) return rotaConversas(request, env, url, email);
  const chave = await chaveDeUso(email);
  if (url.pathname === '/api/ia/estado' && request.method === 'GET') {
    const uso = await lerUso(env, chave);
    return resposta({ email, restantes: Math.max(0, LIMITE_PERGUNTAS - uso.perguntas), limite: LIMITE_PERGUNTAS, configurada: !!env.ANTHROPIC_API_KEY, modelo: modeloDe(env), pode_conferir: podeConferir(email, env) });
  }
  if (url.pathname !== '/api/ia') return erro('não encontrado', 404);
  if (request.method !== 'POST') return erro('método não permitido', 405);
  if (!env.ANTHROPIC_API_KEY) return erro('a IA ainda não foi configurada (falta a chave da Anthropic)', 503);

  const bruto = await request.text();
  if (bruto.length > MAX_CORPO) return erro('conversa longa demais: comece uma nova', 413);
  let corpo;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    return erro('pedido inválido', 400);
  }
  const mensagens = corpo?.mensagens;
  const problema = validar(mensagens);
  if (problema) return erro(problema, 400);

  const nova = ehPergunta(mensagens.at(-1));
  const uso = await lerUso(env, chave);
  if (nova && uso.perguntas >= LIMITE_PERGUNTAS) return erro(`limite de ${LIMITE_PERGUNTAS} perguntas por dia atingido`, 429);
  if (uso.chamadas >= LIMITE_CHAMADAS) return erro('limite diário de consultas atingido', 429);

  // trim: a chave colada no painel da Cloudflare às vezes vem com espaço ou quebra de linha
  const segredo = env.ANTHROPIC_API_KEY.trim().replace(/^["']|["']$/g, '');
  const paineis = paineisDoPedido(corpo.paineis);
  const local = url.hostname === 'localhost';
  const pedido = {
    model: modeloDe(env),
    max_tokens: MAX_SAIDA,
    thinking: { type: 'adaptive' },
    // 'high': indicado no Haiku para seguir instruções à risca (as regras do painel); ainda custa pouco
    output_config: { effort: 'high' },
    // instruções fixas com marcador próprio; o restante da conversa entra no cache automático
    cache_control: { type: 'ephemeral' },
    system: [
      ...instrucoes(paineis, {
        // no desenvolvimento local (wrangler dev) o R2 simulado não tem o manifesto: vale o do navegador
        manifesto: (await lerManifesto(env)) ?? (local && corpo.manifesto && typeof corpo.manifesto === 'object' ? corpo.manifesto : null),
        // anos e microdados do mercado de trabalho vêm do navegador: podem existir só no computador local
        contextoTrabalho: corpo.contexto,
      }),
      { type: 'text', text: IDIOMA[corpo.idioma === 'en' ? 'en' : 'pt'] },
    ],
    tools: FERRAMENTAS,
    messages: mensagens,
  };
  // mesmo só com responder estrita, a gramática às vezes passa do limite da API (400 "compiled grammar is too
  // large", não cobrado): repete sem modo estrito; a página confere e normaliza a resposta do mesmo jeito
  // por streaming (o SDK recusa, ou a conexão cai, numa chamada longa sem ele); a página recebe a mensagem inteira no fim
  const criar = async (cliente) => {
    try {
      return await cliente.messages.stream(pedido).finalMessage();
    } catch (e) {
      if (!gramaticaGrande(e)) throw e;
      console.log(JSON.stringify({ ia: { estrito: false } }));
      return cliente.messages.stream({ ...pedido, tools: SEM_ESTRITO }).finalMessage();
    }
  };
  let msg;
  try {
    // chaves de API vão no cabeçalho x-api-key; as chaves de usuário do console novo (sk-ant-usr-…) podem
    // exigir Authorization: Bearer. Recusada a primeira forma (401, não cobrado), tenta a outra.
    try {
      msg = await criar(new Anthropic({ apiKey: segredo }));
    } catch (e) {
      if (!(e instanceof Anthropic.AuthenticationError)) throw e;
      msg = await criar(new Anthropic({ apiKey: null, authToken: segredo }));
      console.log(JSON.stringify({ ia: { autenticacao: 'bearer' } }));
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return erro('a chave da Anthropic gravada no Worker foi recusada (401): confira se é a chave ativa no console', 502);
    if (e instanceof Anthropic.RateLimitError) return erro('a IA está sobrecarregada; tente de novo em instantes', 503);
    if (e instanceof Anthropic.BadRequestError) return erro(`pedido recusado pela API: ${e.message}`, 400);
    if (e instanceof Anthropic.APIError) return erro(`falha na API da Anthropic (${e.status ?? 'sem status'})`, 502);
    throw e;
  }

  const atualizado = { perguntas: uso.perguntas + (nova ? 1 : 0), chamadas: uso.chamadas + 1 };
  await env.DADOS.put(chave, JSON.stringify(atualizado), { httpMetadata: { contentType: 'application/json' } });
  console.log(JSON.stringify({ ia: { paineis, parada: msg.stop_reason, modelo: msg.model, uso: msg.usage } }));

  return resposta({
    conteudo: msg.content,
    parada: msg.stop_reason,
    recusa: msg.stop_reason === 'refusal' ? (msg.stop_details?.explanation ?? null) : undefined,
    restantes: Math.max(0, LIMITE_PERGUNTAS - atualizado.perguntas),
  });
}
