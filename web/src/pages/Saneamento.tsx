import {useEffect,useMemo,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {leitorSan,linhaSan,linhasCompletasSan,posicoesSan,useRecursoSan,ufDoMunicipioSan,type GrupoSan,type IndSan,type LinhaSan,type MetaSan,type TerrSan} from '../saneamento_dados';
import {t,useIdioma} from '../idioma';
import {nomeDaUf} from '../ufs';
import {Estado,Kpi} from '../components/Kpi';
import {Dica} from '../components/Dica';
import {BotoesExportar} from '../components/Exportar';
import {CartaoGrafico,Grafico,linhas} from '../components/Grafico';
import {IndiceSaude} from '../components/IndicePainel';
import {BuscaPainel,corresponde,TemaPainel,useExplorarPainel} from '../explorar_painel';
import '../saneamento.css';

const TEMAS=()=>[{id:'agua',nome:t('Água','Water')},{id:'esgoto',nome:t('Esgoto','Sewage')},{id:'residuos',nome:t('Resíduos e coleta seletiva','Waste and selective collection')},{id:'drenagem',nome:t('Drenagem e risco de inundação','Drainage and flood risk')}];
const nome=(i:IndSan)=>t(i.nome,i.nome_en);
const fonte=(ano:number)=>ano<=2022?'SNIS':'SINISA';
const unidade=(i:IndSan)=>({economias:t('unidades','units'),entidades:t('entidades','entities'),ocorrencias:t('ocorrências/ano','events/year'),obitos:t('óbitos/ano','deaths/year'),imoveis:t('imóveis/ano','properties/year'),m3:'m³',percentual:'%',pessoas:t('pessoas','people'),ligacoes:t('ligações','connections'),km:'km',m3_ano:'m³/'+t('ano','year'),t_ano:'t/'+t('ano','year'),domicilios:t('domicílios','households')}[i.unidade]??i.unidade);
function valor(i:IndSan,v:number|null){if(v===null)return '—';const loc=t('pt-BR','en-US');if(i.unidade==='percentual')return new Intl.NumberFormat(loc,{maximumFractionDigits:1}).format(v)+'%';return new Intl.NumberFormat(loc,{maximumFractionDigits:i.unidade==='km'||Math.abs(v)>=1e6?1:0,notation:Math.abs(v)>=1e6?'compact':'standard'}).format(v);}
export function condicaoSan(c:number){return [t('observado','observed'),t('sem registro','no record'),t('denominador ausente','denominator missing'),t('indefinido: denominador zero','undefined: zero denominator'),t('inconsistência na origem','inconsistent source data'),t('fora da cobertura da fonte','outside source coverage'),t('sem resposta ao módulo','module not answered')][c]??t('indisponível','unavailable');}
const numero=(v:number)=>new Intl.NumberFormat(t('pt-BR','en-US'),{maximumFractionDigits:2}).format(v);

function usePainelSan(){
 const [sp,setSp]=useSearchParams();const ufSolicitada=(sp.get('uf')??'').trim().toUpperCase();const pedido=sp.get('cod')??sp.get('ente')??'';const cod=pedido==='53'?'5300108':pedido;const uf=(cod&&ufDoMunicipioSan(cod))||ufSolicitada;
 const meta=useRecursoSan(()=>leitorSan.meta(),[]);
 const dados=useRecursoSan(async()=>{const territorio=await leitorSan.territorio(cod,uf);return{territorio,grupo:await leitorSan.grupo(territorio)};},[uf,cod]);
 const solicitado=sp.get('ano');const ano=meta.dado?.anos.includes(Number(solicitado))?Number(solicitado):meta.dado?.anos.at(-1)??0;
 const chave=cod||uf||'BR';const pronto=!!meta.dado&&dados.dado?.territorio.grupo===chave;
 const definir=(v:Record<string,string|null>)=>{const n=new URLSearchParams(sp);for(const[k,x]of Object.entries(v))if(x===null||x==='')n.delete(k);else n.set(k,x);setSp(n);};
 return{sp,uf,ufSolicitada,cod,ano,solicitado,meta,dados,pronto,definir};
}
type ContextoSan=ReturnType<typeof usePainelSan>;
function FiltrosSan({c}:{c:ContextoSan}){
 const [busca,setBusca]=useState(''),[pedir,setPedir]=useState(false);const [sugestoes,setSugestoes]=useState<[string,string,string][]>([]);const[estadoBusca,setEstadoBusca]=useState<'parado'|'carregando'|'pronto'|'erro'>('parado');
 useEffect(()=>{setBusca('');setSugestoes([]);},[c.cod,c.uf]);
 useEffect(()=>{let vivo=true;if(!pedir||busca.trim().length<2){setSugestoes([]);setEstadoBusca('parado');return;}setSugestoes([]);setEstadoBusca('carregando');leitorSan.cadastro().then(rows=>{if(vivo){setSugestoes(rows.filter(r=>(!c.uf||r[2]===c.uf)&&corresponde(busca,r)).slice(0,30));setEstadoBusca('pronto');}}).catch(()=>{if(vivo)setEstadoBusca('erro');});return()=>{vivo=false;};},[busca,c.uf,pedir]);
 const local=c.dados.dado?.territorio;
 return <section className="cartao san-filtros" aria-label={t('Escolher lugar e ano','Choose place and year')}><div className="filtros">
  <div className="campo"><label htmlFor="san-ano">{t('Ano dos dados','Data year')}</label><select id="san-ano" value={c.ano} onChange={e=>c.definir({ano:e.target.value})}>{[...(c.meta.dado?.anos??[])].reverse().map(y=><option key={y}>{y}</option>)}</select></div>
  <div className="campo"><label htmlFor="san-uf">{t('Estado','State')}</label><select id="san-uf" value={local?.uf??c.uf} onChange={e=>c.definir({uf:e.target.value,cod:null,ente:null})}><option value="">{t('Brasil · todos os estados','Brazil · all states')}</option>{c.meta.dado?.grupos.filter(g=>g.nivel==='UF').map(g=><option value={g.grupo} key={g.grupo}>{nomeDaUf(g.grupo)} ({g.grupo})</option>)}</select></div>
  <div className="campo san-busca"><label htmlFor="san-mun">{t('Município','Municipality')}</label><input id="san-mun" value={busca} onFocus={()=>setPedir(true)} onChange={e=>{setPedir(true);setBusca(e.target.value);}} autoComplete="off" placeholder={local?.nivel==='M'?local.nome:t('Busque pelo nome ou código IBGE','Search by name or IBGE code')}/>
   {busca.trim().length>=2&&<ul className="san-sugestoes" aria-live="polite" aria-label={t('Municípios encontrados','Matching municipalities')}>{sugestoes.map(r=><li key={r[0]}><button onClick={()=>{c.definir({cod:r[0],ente:null,uf:r[2]});setBusca('');}}>{r[1]} ({r[2]})</button></li>)}{estadoBusca==='carregando'&&<li>{t('Buscando municípios…','Searching municipalities…')}</li>}{estadoBusca==='erro'&&<li>{t('Não foi possível buscar. Altere a busca para tentar novamente.','Search failed. Change the search to try again.')}</li>}{estadoBusca==='pronto'&&!sugestoes.length&&<li>{t('Nenhum município com essa busca.','No matching municipality.')}</li>}</ul>}
   {c.cod&&<button className="limpar" onClick={()=>c.definir({cod:null,ente:null,uf:local?.uf??c.uf})}>{t('Ver o estado inteiro','View the whole state')}</button>}
  </div>
 </div><p className="san-mini">{t('Você pode buscar um município sem escolher o estado. Os dados aparecem automaticamente.','You can search for a municipality without choosing a state. Figures load automatically.')}</p></section>;
}
function AvisosSan({c}:{c:ContextoSan}){return <>
 {c.solicitado&&Number(c.solicitado)!==c.ano&&c.meta.dado&&<p className="aviso" role="status">{t(`O ano pedido (${c.solicitado}) não está nesta base. A página mostra ${c.ano}, o mais recente disponível.`,`The requested year (${c.solicitado}) is not in this dataset. Showing ${c.ano}, the latest available.`)}</p>}
 {c.dados.dado?.territorio.nivel==='M'&&c.ufSolicitada&&c.dados.dado.territorio.uf!==c.ufSolicitada&&<p className="aviso">{t('O município escolhido define o estado exibido.','The selected municipality determines the displayed state.')}</p>}
 </>;}
function CarregamentoSan({c}:{c:ContextoSan}){return <Estado carregando={!c.meta.erro&&!c.dados.erro&&!c.pronto} erro={c.meta.erro??c.dados.erro} tentarNovamente={()=>{c.meta.recarregar();c.dados.recarregar();}}/>;}
function NotaLinha({l,ter,i}:{l:LinhaSan;ter:TerrSan;i:IndSan}){return <>
 <span>{fonte(l[0])} {l[0]} · {unidade(i)}</span>
 {ter.nivel!=='M'&&<span>{numero(l[5])} {t('municípios com valor','municipalities with a value')} · {t('cadastro','registry')}: {numero(l[6])}</span>}
 </>;}
function DadosDaMedida({i,l}:{i:IndSan;l:LinhaSan}){return <Dica rotulo={t('Como ler','How to read')}><p>{t(i.descricao,i.descricao_en)}</p><p>{t('Condição','Condition')}: {condicaoSan(l[7])}.</p>{l[3]!==null&&<p>{t('Numerador ou soma observada','Numerator or observed sum')}: {numero(l[3])}.</p>}{i.regra_agregado==='razao'&&l[4]!==null&&<p>{t('Denominador observado','Observed denominator')}: {numero(l[4])}.</p>}</Dica>;}
function linhasExportacao(m:MetaSan,g:GrupoSan,ter:TerrSan){return linhasCompletasSan(m,g).map(l=>[ter.grupo,ter.nome,ter.uf,l[0],m.indicadores[l[1]].variavel,nome(m.indicadores[l[1]]),l[2],unidade(m.indicadores[l[1]]),l[3],l[4],l[5],l[6],condicaoSan(l[7]),fonte(l[0])]);}
const colunas=()=>[t('Código ou grupo','Code or group'),t('Local','Place'),'UF',t('Ano','Year'),t('Variável','Variable'),t('Indicador','Indicator'),t('Valor','Value'),t('Unidade','Unit'),t('Numerador ou soma','Numerator or sum'),t('Denominador','Denominator'),t('Municípios com valor','Municipalities with a value'),t('Municípios no cadastro','Municipalities in registry'),t('Condição','Condition'),t('Sistema','System')];
function HistoricoSan({m,g,ter,i,idx}:{m:MetaSan;g:GrupoSan;ter:TerrSan;i:IndSan;idx:number}){
 const series=[{nome:'SNIS (2013–2022)',valores:m.anos.map(y=>y<=2022?linhaSan(m,g,y,idx)[2]:null)},{nome:'SINISA (2023–2024)',valores:m.anos.map(y=>y>=2023?linhaSan(m,g,y,idx)[2]:null)}];
 const tabela=<table><thead><tr><th>{t('Ano','Year')}</th><th>{t('Valor','Value')}</th><th>{t('Condição','Condition')}</th></tr></thead><tbody>{m.anos.map(y=>{const l=linhaSan(m,g,y,idx);return<tr key={y}><td>{y}</td><td>{valor(i,l[2])}</td><td>{condicaoSan(l[7])}</td></tr>;})}</tbody></table>;
 return <CartaoGrafico titulo={nome(i)} desc={`${ter.nome} · ${unidade(i)}`} tabela={tabela}><Grafico nome={'saneamento_'+i.id} animacao={false} opcao={linhas(m.anos,series,v=>valor(i,v),[{x:'2023',rotulo:t('novo sistema','new system')}])} metadadosImagem={{titulo:nome(i),contexto:`${ter.nome} · 2013–${m.anos.at(-1)} · ${unidade(i)} · ${t('SNIS até 2022; SINISA desde 2023. Mudança de metodologia.','SNIS through 2022; SINISA from 2023. Methodology changed.')}`,fonte:t('Ministério das Cidades · SNIS / SINISA · agregação LAPAM/UFG','Ministry of Cities · SNIS / SINISA · aggregation LAPAM/UFG')}}/></CartaoGrafico>;
}

export function SaneamentoPainel(){
 useIdioma();const c=usePainelSan();const raiz=useRef<HTMLDivElement>(null);const explorar=useExplorarPainel(TEMAS().map(t=>'san-'+t.id));const [historicos,setHistoricos]=useState<Record<string,string>>({});
 const m=c.meta.dado,ter=c.dados.dado?.territorio,g=c.dados.dado?.grupo;
 const filtrar=(i:IndSan)=>corresponde(explorar.busca,[i.nome,i.nome_en,i.descricao,i.variavel,TEMAS().find(t=>t.id===i.tema)?.nome]);
 const card=(i:IndSan,idx:number)=>{const l=linhaSan(m!,g!,c.ano,idx);return <Kpi key={i.id} rotulo={nome(i)} valor={l[2]===null?condicaoSan(l[7]):valor(i,l[2])} dica={<DadosDaMedida i={i} l={l}/>} nota={<NotaLinha i={i} l={l} ter={ter!}/>}/>;};
 return <div className="san-painel"><h2 className="titulo-pagina">{t('Saneamento: água, esgoto, resíduos e drenagem','Sanitation: water, sewage, waste and drainage')}</h2><p className="subtitulo">{ter?.nome??t('Brasil','Brazil')}{c.ano?` · ${c.ano} · ${fonte(c.ano)}`:''}</p>
 <FiltrosSan c={c}/><AvisosSan c={c}/><CarregamentoSan c={c}/>
 {c.pronto&&m&&g&&ter&&<>
 <div className="kpis kpis-4">{['agua_cobertura_pct','esgoto_cobertura_pct','residuos_coleta_pct','drenagem_rede_pct'].map(id=>{const idx=m.indicadores.findIndex(i=>i.id===id);return idx>=0?card(m.indicadores[idx],idx):null;})}</div>
 <p className="san-leitura" role="note">{t('Os percentuais de água, esgoto e coleta se referem a pessoas. Drenagem se refere à extensão das vias urbanas. Ausência de informação não é zero.','Water, sewage and waste collection percentages refer to people. Drainage refers to urban road length. Missing information is not zero.')}{ter.nivel!=='M'&&<> {t('UF e Brasil: apenas municípios com dados válidos; confira a cobertura de cada cartão. São agregados do LAPAM, não estimativas para os municípios sem resposta.','State and Brazil: only municipalities with valid data; check each card’s coverage. LAPAM aggregates do not estimate nonresponding municipalities.')}</>}</p>
 <div ref={raiz}><BuscaPainel explorar={explorar} total={m.indicadores.length} encontrados={m.indicadores.filter(filtrar).length} exemplos={t('Ex.: água, perdas, coleta seletiva, inundação…','E.g. water, losses, selective collection, flooding…')}/><IndiceSaude raiz={raiz}/>
 {TEMAS().map(tema=>{const lista=m.indicadores.map((i,idx)=>({i,idx})).filter(({i})=>i.tema===tema.id&&filtrar(i));if(!lista.length)return null;const id=historicos[tema.id]??lista[0].i.id,sel=lista.find(x=>x.i.id===id)??lista[0];return <TemaPainel key={tema.id} id={'san-'+tema.id} titulo={tema.nome} explorar={explorar}>
 <div className="kpis kpis-4">{lista.map(({i,idx})=>card(i,idx))}</div>
 <div className="san-historico"><label htmlFor={'san-hist-'+tema.id}>{t('Ver a evolução de','Explore the history of')}</label><select id={'san-hist-'+tema.id} value={sel.i.id} onChange={e=>setHistoricos(v=>({...v,[tema.id]:e.target.value}))}>{lista.map(({i})=><option key={i.id} value={i.id}>{nome(i)} · {unidade(i)}</option>)}</select><p className="san-mini">{t('A linha é interrompida entre 2022 e 2023: o sistema e as definições mudaram. Compare os períodos com essa ressalva.','The line breaks between 2022 and 2023 because the system and definitions changed. Keep this qualification when comparing periods.')}</p></div>
 <HistoricoSan m={m} g={g} ter={ter} i={sel.i} idx={sel.idx}/></TemaPainel>;})}
 {!m.indicadores.some(i=>filtrar(i))&&<p role="status">{t('Nenhum indicador com essa busca. Limpe ou tente outro assunto.','No indicators match this search. Clear it or try another topic.')}</p>}
 </div>
 <section className="cartao" aria-label={t('Exportar todos os indicadores','Export all indicators')}><h3>{t('Baixar os dados deste lugar','Download data for this place')}</h3><p>{t('Todos os indicadores e anos deste lugar, mesmo quando a busca ou os temas estão recolhidos. Inclui condição do dado e componentes dos percentuais.','All indicators and years for this place, including those hidden by search or collapsed topics. Includes data status and percentage components.')}</p><BotoesExportar nome={'saneamento_'+ter.grupo} obter={()=>({colunas:colunas(),linhas:linhasExportacao(m,g,ter),metadados:[[t('Fonte','Source'),'Ministério das Cidades · SNIS/SINISA'],[t('Versão','Version'),m.gerado_em],[t('Endereço','Address'),location.href]]as[string,string][]})}/><p><Link to={{pathname:'/downloads',search:`?area=saneamento${ter.uf?'&uf='+ter.uf:''}${ter.nivel==='M'?'&cod='+ter.grupo:''}`}}>{t('Base municipal completa e API para R e Stata','Full municipal dataset and API for R and Stata')}</Link></p></section>
 <p className="nota-base"><Link to={{pathname:'/saneamento/metodologia',search:c.sp.toString()?'?'+c.sp:''}}>{t('Como os indicadores foram calculados e fontes originais','Indicator calculations and original sources')}</Link> · {t('Versão da base','Dataset version')}: {m.gerado_em}</p>
 </>}
 </div>;
}

export function SaneamentoRankings(){
 useIdioma();const c=usePainelSan(),m=c.meta.dado;const id=c.sp.get('ind')??'agua_cobertura_pct';const i=m?.indicadores.find(i=>i.id===id);const [busca,setBusca]=useState(''),[pagina,setPagina]=useState(1);const asc=c.sp.get('ordem')==='asc';
 const rank=useRecursoSan(async()=>{await leitorSan.meta();return leitorSan.ranking(c.ano||((await leitorSan.meta()).anos.at(-1)!),id);},[c.ano,id]);
 const atual=rank.dado?.ano===c.ano&&rank.dado.indicador===id;
 const lista=useMemo(()=>posicoesSan((atual?rank.dado!.linhas:[]).filter(r=>!c.uf||r[2]===c.uf),asc),[rank.dado,atual,c.uf,asc]);const filtrada=lista.filter(x=>corresponde(busca,[x.r[0],x.r[1],x.r[2]]));const total=Math.max(1,Math.ceil(filtrada.length/50)),pg=Math.min(pagina,total);
 useEffect(()=>setPagina(1),[busca,id,c.ano,c.uf,asc]);
 return <><h2 className="titulo-pagina">{t('Saneamento: comparar municípios','Sanitation: compare municipalities')}</h2><p className="subtitulo">{i?nome(i):id} · {c.ano}</p><FiltrosSan c={c}/><AvisosSan c={c}/>
 <div className="filtros"><div className="campo"><label htmlFor="san-ind">{t('Indicador','Indicator')}</label><select id="san-ind" value={id} onChange={e=>c.definir({ind:e.target.value})}>{m?.indicadores.map(i=><option value={i.id} key={i.id}>{nome(i)} · {unidade(i)}</option>)}</select></div><div className="campo"><label htmlFor="san-ordem">{t('Ordenar por','Sort by')}</label><select id="san-ordem" value={asc?'asc':'desc'} onChange={e=>c.definir({ordem:e.target.value})}><option value="desc">{t('Maior valor primeiro','Largest value first')}</option><option value="asc">{t('Menor valor primeiro','Smallest value first')}</option></select></div></div>
 <p className="aviso">{t('Posição não é nota de qualidade: o sentido depende do indicador. Municípios sem valor ou com inconsistência não recebem posição.','Rank is not a quality score: its interpretation depends on the indicator. Missing or inconsistent values are not ranked.')}</p>
 <Estado carregando={rank.carregando||c.meta.carregando} erro={rank.erro??c.meta.erro??c.dados.erro} tentarNovamente={()=>{rank.recarregar();c.meta.recarregar();c.dados.recarregar();}}/>
 {atual&&i&&!c.dados.erro&&<section className="cartao"><div className="campo"><label htmlFor="san-r-busca">{t('Encontrar município','Find a municipality')}</label><input id="san-r-busca" type="search" value={busca} onChange={e=>setBusca(e.target.value)} placeholder={t('Nome ou código IBGE','Name or IBGE code')}/></div><p role="status">{numero(filtrada.length)} {t('de','of')} {numero(lista.length)} {t('municípios com valor; posições preservadas no recorte completo.','municipalities with a value; ranks remain those of the complete scope.')}</p>
 <BotoesExportar nome={'saneamento_ranking_'+id+'_'+c.ano} obter={()=>({colunas:[t('Posição','Rank'),t('Código IBGE','IBGE code'),t('Município','Municipality'),'UF',t('Valor','Value')],linhas:lista.map(({r,pos})=>[pos,r[0],r[1],r[2],r[3]]),metadados:[[t('Indicador','Indicator'),nome(i)],[t('Unidade','Unit'),unidade(i)],[t('Ano','Year'),String(c.ano)],[t('Fonte','Source'),'Ministério das Cidades · '+fonte(c.ano)]]as[string,string][]})}/>
 <div className="paginacao-ranking"><button disabled={pg===1} onClick={()=>setPagina(pg-1)}>{t('Anterior','Previous')}</button><span>{t(`Página ${pg} de ${total}`,`Page ${pg} of ${total}`)}</span><button disabled={pg===total} onClick={()=>setPagina(pg+1)}>{t('Próxima','Next')}</button></div>
 {!filtrada.length&&<p role="status">{!i.anos.includes(c.ano)?t(`Este indicador não tem informação da fonte em ${c.ano}. Anos disponíveis: ${i.anos.join(', ')}.`,`This indicator has no source information for ${c.ano}. Available years: ${i.anos.join(', ')}.`):t('Nenhum município encontrado. Tente outro ano ou outra busca.','No municipality found. Try another year or search.')}</p>}
 <div className="rolagem"><table className="tabela-fixa"><thead><tr><th>#</th><th>{t('Município','Municipality')}</th><th>UF</th><th>{unidade(i)}</th></tr></thead><tbody>{filtrada.slice((pg-1)*50,pg*50).map(({r,pos})=><tr key={r[0]} className={String(r[0])===c.cod?'ranking-selecionado':undefined}><td>{pos}</td><td><Link to={`/saneamento?uf=${r[2]}&cod=${r[0]}&ano=${c.ano}`}>{r[1]}</Link></td><td>{r[2]}</td><td>{valor(i,r[3])}</td></tr>)}</tbody></table></div></section>}
 </>;
}

export function SaneamentoMetodologia(){
 useIdioma();const meta=useRecursoSan(()=>leitorSan.meta(),[]);const m=meta.dado;
 return <><h2 className="titulo-pagina">{t('Saneamento: fontes e metodologia','Sanitation: sources and methodology')}</h2><Estado carregando={meta.carregando} erro={meta.erro} tentarNovamente={meta.recarregar}/>{m&&<>
 <section className="cartao"><h3>{t('Como ler os números','How to read the figures')}</h3>{m.notas.map((n,j)=><p key={j}>{n}</p>)}<p>{t('Cada condição acompanha o valor no arquivo temático. Sem registro, denominador ausente, denominador zero, inconsistência e ano fora da cobertura são estados diferentes. Nenhum deles vira zero. Sem registro também pode indicar ausência de resposta do município ao módulo. Fora da cobertura é reservado a anos sem informação da medida.','Each thematic file includes data status alongside the value. No record, missing denominator, zero denominator, inconsistency and a year outside coverage are different states. None is converted to zero. No record can also mean that the municipality did not answer the module. Outside coverage is reserved for years without information for that measure.')}</p></section>
 <section className="cartao"><h3>{t('Dicionário dos indicadores','Indicator dictionary')}</h3><div className="rolagem"><table><thead><tr><th>{t('Variável','Variable')}</th><th>{t('Indicador e definição','Indicator and definition')}</th><th>{t('Unidade','Unit')}</th><th>{t('Componentes SNIS / SINISA','SNIS / SINISA components')}</th></tr></thead><tbody>{m.indicadores.map(i=><tr key={i.id}><td><code>{i.variavel}</code></td><td><strong>{nome(i)}</strong><p>{t(i.descricao,i.descricao_en)}</p></td><td>{unidade(i)}</td><td>{i.snis.length?i.snis.join(' ÷ '):t('Sem série SNIS comparável','No comparable SNIS series')}<br/>{i.sinisa.join(' ÷ ')}</td></tr>)}</tbody></table></div></section>
 <section className="cartao"><h3>{t('Arquivos oficiais utilizados','Official source files')}</h3><p>{t('O ano abaixo é o ano de referência dos dados, que pode ser anterior ao nome da edição publicada.','The year below is the data reference year, which may precede the published edition name.')}</p>{[...new Set(m.fontes.map(f=>f.ano))].sort((a,b)=>b-a).map(y=><details key={y}><summary>{y}</summary><ul>{m.fontes.filter(f=>f.ano===y).map((f,j)=><li key={j}>{f.modulo} · <a href={f.url} target="_blank" rel="noreferrer">{f.nome}</a></li>)}</ul></details>)}</section>
 <p><a href={new URL(m.consulta.caminho, new URL('/dados/',location.origin)).href}>{t('Parquet detalhado: valores, componentes, cobertura e condições','Detailed Parquet: values, components, coverage and data status')}</a></p>
 </>}</>;
}
