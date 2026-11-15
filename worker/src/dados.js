/** API pública de arquivos municipais, independente da API autenticada da IA. */
import { arquivoDoRecorte, caminhoSeguro, validarCatalogo, validarManifesto, validarPrevia } from '../../web/src/downloads.ts';

const ROOT = '/api/dados/v1';
const FORMATOS = ['dta', 'rds', 'parquet', 'csv.zip'];
const UF = new Set(['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, If-None-Match',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Range, X-Finbra-SHA256, X-Finbra-Edicao',
  'X-Content-Type-Options': 'nosniff',
};

class Falha extends Error {
  constructor(status, codigo, mensagem) { super(mensagem); this.status=status; this.codigo=codigo; }
}

function json(request, data, status=200, extra={}) {
  const body=JSON.stringify(data);
  return new Response(request.method==='HEAD' ? null : body, {
    status,
    headers:{...CORS,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache',...extra},
  });
}

async function lerJson(env, ref) {
  if (!caminhoSeguro(ref.caminho)) throw new Falha(503,'catalogo_invalido','A lista de dados está temporariamente indisponível.');
  const obj=await env.DADOS.get(ref.caminho);
  if (!obj || !('body' in obj)) throw new Falha(503,'dados_indisponiveis','O arquivo ainda não está disponível. Tente novamente.');
  return new Response(obj.body).json();
}

function parametros(url, permitidos) {
  for (const k of url.searchParams.keys()) {
    if (!permitidos.includes(k) || url.searchParams.getAll(k).length!==1) {
      throw new Falha(400,'parametro_invalido',`Parâmetro inválido ou repetido: ${k}. UF e tema selecionam arquivos prontos; anos, municípios e variáveis podem ser filtrados no Stata ou pelo cliente R.`);
    }
  }
}

function recorte(url, m, fixo) {
  parametros(url,fixo ? [] : ['uf','tema']);
  const uf=(fixo?.uf ?? url.searchParams.get('uf') ?? 'BR').trim().toUpperCase();
  const tema=(fixo?.tema ?? url.searchParams.get('tema') ?? 'todos').trim().toLowerCase();
  if (uf!=='BR' && !UF.has(uf)) throw new Falha(400,'uf_invalida','Use BR ou uma sigla de UF, como GO.');
  if (tema!=='todos' && !m.areas.some((a)=>a.id===tema)) throw new Falha(400,'tema_invalido','Tema inválido. Consulte catalogo.json.');
  return {uf:uf==='BR' ? '' : uf, area:tema==='todos' ? '' : tema};
}

async function arquivosDoLocal(env,m,uf) {
  if (!uf || !m.recortes_uf?.[uf]) return m.arquivos;
  const extra=validarCatalogo(await lerJson(env,m.recortes_uf[uf]),m,uf);
  return [...m.arquivos,...extra];
}

function infoArquivo(a, origin) {
  return {
    id:a.id,uf:a.uf ?? 'BR',tema:a.area ?? 'todos',formato:a.formato,
    linhas:a.linhas,variaveis:a.variaveis,identificadores:6,ano_de:a.ano_de,ano_ate:a.ano_ate,
    bytes:a.bytes,sha256:a.sha256,
    url:`${origin}${ROOT}/painel/${a.uf ?? 'BR'}/${a.area ?? 'todos'}.${a.formato}`,
    url_imutavel:`${origin}/dados/${a.caminho}`,
  };
}

async function servirArquivo(request,env,url,a,m,servirDados) {
  if (!caminhoSeguro(a.caminho)) throw new Falha(503,'arquivo_invalido','Arquivo indisponível.');
  const dataUrl=new URL('/dados/'+a.caminho,url.origin);
  const response=await servirDados(request,env,dataUrl);
  if(response.status===404) throw new Falha(503,'arquivo_indisponivel','O arquivo está temporariamente indisponível.');
  if(response.status===200 && response.headers.get('Content-Length')!==String(a.bytes)) throw new Falha(503,'tamanho_invalido','O arquivo não passou na conferência de tamanho.');
  const headers=new Headers(response.headers);
  for (const [k,v] of Object.entries(CORS)) headers.set(k,v);
  // A URL da API é estável; o arquivo imutável por trás dela pode mudar.
  headers.set('Cache-Control','no-cache');
  headers.set('X-Finbra-SHA256',a.sha256);
  headers.set('X-Finbra-Edicao',m.gerado_em);
  const name=a.tipo==='dicionario' ? 'finbra_dicionario' : `finbra_${a.area ?? 'todos'}_${a.uf ?? 'BR'}`;
  headers.set('Content-Disposition',`attachment; filename="${name}.${a.formato}"`);
  if (request.method==='HEAD') headers.delete('Content-Range');
  const status=request.method==='HEAD' && response.status===206 ? 200 : response.status;
  return new Response(response.body,{status,headers});
}

export async function rotaDados(request,env,url,servirDados) {
  try {
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers:{...CORS,'Access-Control-Max-Age':'86400'}});
    if (!['GET','HEAD'].includes(request.method)) return json(request,{erro:{codigo:'metodo_nao_permitido',mensagem:'Use GET ou HEAD.'}},405,{Allow:'GET, HEAD, OPTIONS'});
    const path=url.pathname;
    if (path===ROOT+'/cliente.R') {
      parametros(url,[]);
      const source=await env.ASSETS.fetch(new Request(new URL('/finbra.R',url.origin),{headers:{'Accept-Encoding':'identity'}}));
      if(!source.ok) throw new Falha(503,'cliente_indisponivel','O cliente R está temporariamente indisponível.');
      const body=(await source.text())+'\n.finbra_base <- '+JSON.stringify(url.origin+ROOT)+'\n';
      const headers=new Headers(source.headers);
      for(const [k,v] of Object.entries(CORS)) headers.set(k,v);
      headers.set('Content-Type','text/plain; charset=utf-8');headers.set('Cache-Control','no-cache');
      headers.delete('Content-Encoding');headers.delete('ETag');headers.set('Content-Length',String(new TextEncoder().encode(body).length));
      return new Response(request.method==='HEAD'?null:body,{status:source.status,headers});
    }
    const main=await env.DADOS.get('gold/downloads/manifesto.json');
    if(!main || !('body' in main)) throw new Falha(503,'catalogo_indisponivel','A lista de dados está temporariamente indisponível.');
    const parsed=validarManifesto(await new Response(main.body).json());
    if(parsed.descartados || parsed.manifesto.edicao!=='enxuta_2013') throw new Falha(503,'catalogo_incompleto','A lista de dados não passou na conferência. Tente novamente.');
    const m=parsed.manifesto;
    if(path===ROOT || path===ROOT+'/' || path===ROOT+'/catalogo.json') {
      const {uf,area}=recorte(url,m);
      const files=await arquivosDoLocal(env,m,uf);
      return json(request,{
        api_versao:'v1',arquivos_gerados_em:m.gerado_em,base_gerado_em:m.base_gerado_em,base_sha256:m.base_sha256,
        resumo:m.resumo,temas:[{id:'todos',nome:'Todos os temas'},...m.areas.map(({id,nome,nome_en})=>({id,nome,nome_en}))],ufs:['BR',...UF].sort(),
        selecao:{uf:uf||'BR',tema:area||'todos'},
        arquivos:FORMATOS.map(f=>arquivoDoRecorte(files,area,uf,f)).filter(Boolean).map(a=>infoArquivo(a,url.origin)),
        dicionario:`${url.origin}${ROOT}/dicionario.json`,cliente_r:`${url.origin}${ROOT}/cliente.R`,
        notas:['Base municipal desde 2013; cobertura varia por variável.','UF e tema selecionam arquivos prontos. Filtros de ano, município e coluna são aplicados no cliente.','URL estável entrega a edição atual; url_imutavel e sha256 identificam o arquivo exato.','Não se substituem ausências por zero; confira unidades e condições no dicionário.'],
      });
    }
    const direct=path.match(new RegExp('^'+ROOT+'/painel/([A-Za-z]{2})/([a-z]+)\\.(dta|rds|parquet|csv\\.zip)$'));
    const query=path.match(new RegExp('^'+ROOT+'/painel\\.(dta|rds|parquet|csv\\.zip)$'));
    if(direct || query || path===ROOT+'/amostra.json') {
      const {uf,area}=recorte(url,m,direct ? {uf:direct[1],tema:direct[2]} : null);
      const files=await arquivosDoLocal(env,m,uf);
      const formato=direct?.[3] ?? query?.[1] ?? 'parquet';
      const a=arquivoDoRecorte(files,area,uf,formato);
      if(!a) throw new Falha(404,'recorte_indisponivel','Não há arquivo para essa UF, tema e formato. Consulte catalogo.json.');
      if(path===ROOT+'/amostra.json') {
        if(!a.previa) throw new Falha(404,'amostra_indisponivel','Prévia indisponível.');
        const p=validarPrevia(await lerJson(env,a.previa),a);
        return json(request,{api_versao:'v1',tipo:'amostra',arquivo:infoArquivo(a,url.origin),...p,nota:'Esta é uma amostra de até cinco linhas, não a base completa.'});
      }
      return await servirArquivo(request,env,url,a,m,servirDados);
    }
    const dict=path.match(new RegExp('^'+ROOT+'/dicionario\\.(json|rds|xlsx|csv\\.zip)$'));
    if(dict) {
      parametros(url,dict[1]==='json' ? ['tema'] : []);
      if(dict[1]==='json') {
        const tema=url.searchParams.get('tema') ?? '';
        if(tema && tema!=='todos' && !m.areas.some(a=>a.id===tema)) throw new Falha(400,'tema_invalido','Tema inválido.');
        const entries=await lerJson(env,m.dicionario);
        return json(request,tema && tema!=='todos' ? entries.filter(e=>e.area===tema || e.area==='identificacao') : entries);
      }
      const a=m.arquivos.find(a=>a.tipo==='dicionario' && a.escopo!=='detalhado' && a.formato===dict[1]);
      if(!a) throw new Falha(404,'formato_indisponivel','Dicionário indisponível nesse formato.');
      return await servirArquivo(request,env,url,a,m,servirDados);
    }
    throw new Falha(404,'rota_inexistente',`Rota inexistente. Consulte ${ROOT}/catalogo.json.`);
  } catch(e) {
    const known=e instanceof Falha;
    return json(request,{api_versao:'v1',erro:{codigo:known ? e.codigo : 'indisponivel',mensagem:known ? e.message : 'A API está temporariamente indisponível. Tente novamente.'}},known ? e.status : 503,known && e.status<500 ? {} : {'Retry-After':'30'});
  }
}
