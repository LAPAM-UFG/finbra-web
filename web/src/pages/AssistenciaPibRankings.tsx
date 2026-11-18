import { lazy, Suspense, useEffect, useId, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import '../assistencia.css';
import { filtrarRankingPib, type LinhaRankingPib, type MedidaRankingPib } from '../assistencia_economia';
import { BASES_REFERENCIA, condicaoReferencia, enderecoReferencia, formatarReferencia, nomeBase, nomeDenominador, notaReferencia, obterMetaReferencias, obterRankingReferencia, ultimoAnoReferencia, unidadeReferencia, type BaseReferencia } from '../assistencia_referencias';
import { useSocial } from '../assistencia_dados';
import { AjudaAssistencia } from '../components/AjudaAssistencia';
import { Estado } from '../components/Kpi';
import { exportar, type Tabela } from '../exportar';
import { numero, reais, reaisExato } from '../format';
import { idioma, t } from '../idioma';
import { UF_NOMES } from '../ufs';

const carregarMapa=()=>import('../components/MapaAssistenciaPib');
const MapaAssistenciaPib=lazy(carregarMapa);
const MEDIDAS:MedidaRankingPib[]=['pbf','bpc','total'];
const nome=(m:MedidaRankingPib)=>m==='pbf'?'Bolsa Família / Auxílio Brasil':m==='bpc'?'BPC':t('Os dois programas','Both programmes');
const rotuloMunicipio=(l:LinhaRankingPib)=>l[0]===2605459?`${l[1]} (${t('distrito estadual','state district')})`:l[0]===5300108?`${l[1]} (${t('ente único','single entity')})`:l[1];
const painel=(l:LinhaRankingPib,ano:number,base:BaseReferencia)=>`/assistencia?uf=${l[2]}&cod=${l[0]}&ano_comparacao=${ano}&base_comparacao=${base}#pagamentos-pib`;

export function AssistenciaPibRankings() {
  const [sp,setSp]=useSearchParams();const id=useId();const location=useLocation();
  const meta=useSocial('referencias-meta',obterMetaReferencias);const m=meta.dados;
  const rawBase=sp.get('base_comparacao')??(location.pathname.endsWith('rankings-pib')||sp.has('ano_pib')?'pib':'populacao');
  const base:BaseReferencia=BASES_REFERENCIA.includes(rawBase as BaseReferencia)?rawBase as BaseReferencia:'populacao';
  const rawMedida=sp.get('medida')||'pbf';const medida:MedidaRankingPib=MEDIDAS.includes(rawMedida as MedidaRankingPib)?rawMedida as MedidaRankingPib:'pbf';
  const rawUf=(sp.get('uf')||'BR').trim().toUpperCase();const uf=rawUf==='BR'||Object.hasOwn(UF_NOMES,rawUf)?rawUf:'BR';
  const rawAno=sp.get('ano_comparacao')??sp.get('ano_pib');const anoValido=!!m&&!!rawAno&&/^\d{4}$/.test(rawAno)&&m.anos.includes(Number(rawAno));
  const ano=anoValido?Number(rawAno):m?ultimoAnoReferencia(m,base):undefined;
  const consulta=useSocial(ano?`ranking-referencia:${base}:${medida}:${ano}:${uf}`:null,()=>obterRankingReferencia(base,medida,ano!,uf));const r=consulta.dados;
  const busca=sp.get('busca')??'';const mapa=sp.get('vista')==='mapa';
  useEffect(()=>{if(mapa)void carregarMapa().then(m=>m.prepararMapa(uf)).catch(()=>{});},[mapa,uf]);
  const filtradas=useMemo(()=>filtrarRankingPib(r?.linhas??[],busca),[r,busca]);const tamanho=25;const paginaPedida=Number(sp.get('pagina')??1);
  const pagina=Math.min(Number.isSafeInteger(paginaPedida)&&paginaPedida>0?paginaPedida-1:0,Math.max(0,Math.ceil(filtradas.length/tamanho)-1));
  const visiveis=filtradas.slice(pagina*tamanho,(pagina+1)*tamanho);
  const mudar=(extra:Record<string,string|null>)=>{
    const n=new URLSearchParams(sp);n.set('medida',medida);n.set('base_comparacao',base);n.delete('ano_pib');
    if(ano)n.set('ano_comparacao',String(ano));
    if(['medida','base_comparacao','ano_comparacao','uf'].some(k=>k in extra))n.delete('pagina');
    if('uf'in extra)n.delete('cod');
    for(const[k,v]of Object.entries(extra)){if(v===null||v===''||(k==='uf'&&v==='BR')||(k==='pagina'&&v==='1'))n.delete(k);else n.set(k,v);}
    if('base_comparacao'in extra)n.delete('ano_comparacao');
    setSp(n,{replace:'busca'in extra});
  };
  const recorte=uf==='BR'?t('Brasil','Brazil'):`${UF_NOMES[uf]?.[0]??uf} (${uf})`;
  const origem=/^\d{7}$/.test(sp.get('cod')??'')?r?.linhas.find(l=>l[0]===Number(sp.get('cod'))):undefined;
  const ufs=useMemo(()=>Object.entries(UF_NOMES).sort((a,b)=>a[1][0].localeCompare(b[1][0],'pt-BR')),[]);
  const retorno=`/assistencia?${new URLSearchParams({base_comparacao:base,...(uf!=='BR'?{uf}:{}),...(/^\d{7}$/.test(sp.get('cod')??'')?{cod:sp.get('cod')!}:{}),...(ano?{ano_comparacao:String(ano)}:{})})}#pagamentos-pib`;
  const tabela=():Tabela=>({
    colunas:['posicao','cod_ibge','municipio','uf','ano','programa','referencia','valor','unidade','pagamentos_anuais_nominais','denominador','estimativa'],
    linhas:filtradas.map(l=>[l[3],l[0],l[1],l[2],ano!,nome(medida),base,l[4],unidadeReferencia(base),l[5],l[6],base==='rais'?'massa de dezembro x 12':'']),
    metadados:[[t('Recorte','Scope'),`${recorte} · ${ano} · ${nome(medida)}`],[t('Cálculo','Calculation'),notaReferencia(base)],[t('Cobertura','Coverage'),`${r?.cobertura.validos??0}/${r?.cobertura.total??0}`],[t('Empates','Ties'),t('Posições 1, 2, 2, 4 antes do arredondamento. A busca preserva as posições do recorte completo.','Ranks 1, 2, 2, 4 before rounding. Search preserves full-scope ranks.')],[t('Valores','Amounts'),t('Pagamentos nominais de 12 meses válidos; não se estimam meses ausentes.','Nominal payments over 12 valid months; missing months are not estimated.')],[t('Fontes','Sources'),'CGU; MTE/RAIS; IBGE; LAPAM/UFG']],
  });
  const paginas=(s:string)=><nav className="as-ranking-pib-paginacao" aria-label={t(`Paginação ${s}`,`Pagination ${s}`)}><button className="botao-leve" disabled={pagina===0} onClick={()=>mudar({pagina:String(pagina)})}>{t('Anterior','Previous')}</button><span>{t(`Página ${pagina+1} de ${Math.max(1,Math.ceil(filtradas.length/tamanho))}`,`Page ${pagina+1} of ${Math.max(1,Math.ceil(filtradas.length/tamanho))}`)}</span><button className="botao-leve" disabled={(pagina+1)*tamanho>=filtradas.length} onClick={()=>mudar({pagina:String(pagina+2)})}>{t('Próxima','Next')}</button></nav>;
  return <div className="assistencia-painel">
    <h2 className="titulo-pagina">{t('Pagamentos: compare os municípios','Payments: compare municipalities')}</h2>
    <p className="as-sub">{t('Bolsa Família e BPC por habitante, em relação à massa salarial formal estimada ou ao PIB. Ranking e mapa usam os mesmos filtros e números prontos.','Bolsa Família and BPC per resident, relative to estimated formal payroll or GDP. Ranking and map share filters and ready-made figures.')}</p>
    <nav className="as-nav" aria-label={t('Seções de assistência social','Social assistance sections')}><Link to={retorno}>{t('Painel','Overview')}</Link><Link to={`/assistencia/rankings${uf!=='BR'?`?uf=${uf}`:''}`}>{t('Rankings mensais','Monthly rankings')}</Link><Link to={`/assistencia/comparacoes-pagamentos?${sp}`} aria-current="page">{t('Comparações dos pagamentos','Payment comparisons')}</Link></nav>
    {meta.carregando&&<Estado carregando/>}{meta.erro&&<Estado erro={meta.erro} tentarNovamente={meta.recarregar}/>}
    {m&&<>
      <form className="as-ranking-pib-filtros cartao" onSubmit={e=>e.preventDefault()} aria-label={t('Filtros da comparação anual','Yearly comparison filters')}>
        <div className="as-campo"><label htmlFor={`${id}-base`}>{t('Referência da comparação','Comparison reference')}</label><select id={`${id}-base`} value={base} onChange={e=>mudar({base_comparacao:e.target.value})}>{BASES_REFERENCIA.map(b=><option key={b} value={b}>{nomeBase(b)}</option>)}</select></div>
        <div className="as-campo"><label htmlFor={`${id}-programa`}>{t('Programa','Programme')}</label><select id={`${id}-programa`} value={medida} onChange={e=>mudar({medida:e.target.value})}>{MEDIDAS.map(k=><option key={k} value={k}>{nome(k)}</option>)}</select></div>
        <div className="as-campo"><label htmlFor={`${id}-ano`}>{t('Ano da comparação','Comparison year')}</label><select id={`${id}-ano`} value={ano} onChange={e=>mudar({ano_comparacao:e.target.value})}>{[...m.anos].reverse().map(y=><option key={y} value={y}>{y}{!m.anos_com_valor[base].includes(y)?t(' · sem comparação completa',' · no complete comparison'):''}</option>)}</select></div>
        <div className="as-campo"><label htmlFor={`${id}-uf`}>{t('Comparar municípios de','Compare municipalities in')}</label><select id={`${id}-uf`} value={uf} onChange={e=>mudar({uf:e.target.value})}><option value="BR">{t('Brasil · todos os estados','Brazil · all states')}</option>{ufs.map(([sigla,[n]])=><option key={sigla} value={sigla}>{n} ({sigla})</option>)}</select></div>
      </form>
      {(rawUf!==uf||rawMedida!==medida||rawBase!==base||(!!rawAno&&!anoValido))&&<p role="status">{t(`Filtro inválido no endereço. Mostrando ${nome(medida)}, ${ano}, ${recorte}.`,`Invalid URL filter. Showing ${nome(medida)}, ${ano}, ${recorte}.`)}</p>}
      <p className="as-recorte">{nome(medida)} · {nomeBase(base)} · {ano} · {recorte}</p>
      <div className={base==='rais'?'as-referencia-nota':'as-resumo'}>{base==='rais'&&<strong>{t('Estimativa anual: dezembro × 12','Yearly estimate: December × 12')}</strong>}<p>{notaReferencia(base)} <AjudaAssistencia rotulo={t('Como a comparação é calculada','How the comparison is calculated')}><p>{t('Só entram pagamentos de 12 meses válidos e denominador positivo. Empates usam 1, 2, 2, 4, sem arredondar as razões para ordenar. Valores maiores não são notas de qualidade. Na RAIS, confira a cobertura da remuneração ao abrir o município.','Requires 12 valid payment months and a positive denominator. Ties use 1, 2, 2, 4 without rounding ratios to rank. Higher values are not quality scores. For RAIS, check reported-pay coverage when opening the municipality.')}</p></AjudaAssistencia></p></div>
      <div className="as-mapa-pib-vistas" role="group" aria-label={t('Visualização da comparação','Comparison view')}><button className="botao-leve" aria-pressed={!mapa} onClick={()=>mudar({vista:'ranking'})}>{t('Ranking','Ranking')}</button><button className="botao-leve" aria-pressed={mapa} onClick={()=>mudar({vista:'mapa'})}>{t('Mapa','Map')}</button></div>
      {consulta.carregando&&<Estado carregando/>}{consulta.erro&&<Estado erro={consulta.erro} tentarNovamente={consulta.recarregar}/>}
      {r&&<section className="cartao as-ranking-pib-resultados" aria-label={t('Ranking municipal dos pagamentos','Municipal payment ranking')}>
        <p role="status">{t(`${numero(r.cobertura.validos)} municípios e territórios equiparados com valor válido; ${numero(r.cobertura.total-r.cobertura.validos)} sem valor.`,`${numero(r.cobertura.validos)} municipalities and equivalent territories with a valid value; ${numero(r.cobertura.total-r.cobertura.validos)} without one.`)}</p>
        <details className="as-ranking-pib-cobertura"><summary>{t('Ver cobertura e motivos das exclusões','See coverage and reasons for exclusions')}</summary><p>{t('Cadastro territorial atual, com DF/Brasília uma vez e Fernando de Noronha. Municípios ainda não existentes no ano podem ficar sem dados. Ausência não é zero.','Current territorial registry, with DF/Brasília counted once and Fernando de Noronha. Municipalities not yet created may have no data. Missing is not zero.')}</p><ul>{r.cobertura.condicoes.map((n,c)=><li key={c}>{condicaoReferencia(c,base)}: {numero(n)}</li>)}</ul></details>
        {origem&&<p className="as-ranking-pib-local">{rotuloMunicipio(origem)} ({origem[2]}) · {t('posição','rank')} {numero(origem[3])} · {formatarReferencia(origem[4],base)} <button className="botao-leve" onClick={()=>mudar({busca:String(origem[0])})}>{t('Localizar na lista','Find in list')}</button></p>}
        <div className="as-ranking-pib-busca"><label htmlFor={`${id}-busca`}>{t('Encontrar município ou código IBGE','Find a municipality or IBGE code')}</label><input id={`${id}-busca`} type="search" value={busca} onChange={e=>mudar({busca:e.target.value})} placeholder={t('Ex.: Goiânia ou 5208707','E.g. Goiânia or 5208707')}/>{busca&&<button className="botao-leve" onClick={()=>mudar({busca:''})}>{t('Limpar busca','Clear search')}</button>}</div>
        {!mapa&&<p className="as-resumo" role="status">{t(`${numero(filtradas.length)} de ${numero(r.linhas.length)} registros encontrados. A busca preserva as posições do recorte completo.`,`${numero(filtradas.length)} of ${numero(r.linhas.length)} records found. Search preserves full-scope ranks.`)}</p>}
        {r.linhas.length===0&&<p>{t('Sem valores válidos. Anos com dados neste programa:','No valid values. Years with data for this programme:')} {r.anos_com_valor.join(', ')}.</p>}
        <div className="as-acoes"><span>{t('Baixar ranking filtrado completo:','Download the complete filtered ranking:')}</span>{(['csv','xlsx'] as const).map(f=><button key={f} className="botao-leve" disabled={!filtradas.length} onClick={()=>exportar(`ranking_assistencia_${base}_${medida}_${ano}_${uf}`,f,tabela(),idioma()==='en'?'.':',')}>{f==='csv'?'CSV':'Excel'}</button>)}</div>
        {mapa&&<Suspense fallback={<Estado carregando/>}><MapaAssistenciaPib ranking={r} busca={busca} selecionado={sp.get('cod')} selecionar={cod=>mudar({cod})} titulo={nome(medida)}/></Suspense>}
        {!mapa&&filtradas.length>0&&<>{paginas('superior')}
          <div className="as-ranking-pib-desktop"><table className="as-tabela as-ranking-pib-tabela"><caption>{nome(medida)} · {nomeBase(base)} · {ano} · {recorte}</caption><thead><tr><th>{t('Posição','Rank')}</th><th>{t('Município','Municipality')}</th><th>UF</th><th className="as-num">{unidadeReferencia(base)}</th><th className="as-num">{t('Pagamentos no ano','Yearly payments')}</th><th className="as-num">{nomeDenominador(base)}</th></tr></thead><tbody>{visiveis.map(l=><tr key={l[0]}><td>{numero(l[3])}</td><td><Link to={painel(l,ano!,base)}>{rotuloMunicipio(l)}</Link><small className="as-ranking-pib-codigo">{l[0]}</small></td><td>{l[2]}</td><td className="as-num"><strong>{formatarReferencia(l[4],base)}</strong></td><td className="as-num">{reaisExato(l[5])}</td><td className="as-num">{base==='populacao'?numero(l[6]):reaisExato(l[6])}</td></tr>)}</tbody></table></div>
          <ol className="as-ranking-pib-cards" aria-label={t('Ranking municipal','Municipal ranking')}>{visiveis.map(l=><li key={l[0]}><span className="as-ranking-pib-pos">{numero(l[3])}</span><div><Link to={painel(l,ano!,base)}>{rotuloMunicipio(l)}</Link><small className="as-ranking-pib-codigo">{l[2]} · {l[0]}</small></div><strong className="as-ranking-pib-percentual">{formatarReferencia(l[4],base)}</strong><dl><div><dt>{t('Pagamentos no ano','Yearly payments')}</dt><dd>{reais(l[5])}</dd></div><div><dt>{nomeDenominador(base)}</dt><dd>{base==='populacao'?numero(l[6]):reais(l[6])}</dd></div></dl></li>)}</ol>
          {paginas('inferior')}</>}
      </section>}
      <p className="as-resumo">{t('Valores monetários nominais: a evolução por habitante inclui a inflação. PBF/Auxílio Brasil não inclui o Benefício Extraordinário (2021–2023). BPC inclui retroativos presentes no total. Fontes: CGU, MTE/RAIS e IBGE.','Monetary amounts are nominal: per-resident changes include inflation. PBF/Auxílio Brasil excludes the extraordinary benefit (2021–2023). BPC includes retroactive amounts already in the total. Sources: CGU, MTE/RAIS and IBGE.')}</p>
      <div className="as-acoes"><span>{t('Base municipal completa:','Complete municipal dataset:')}</span>{m.downloads.map(o=><a key={o.formato} className="botao-leve" href={enderecoReferencia(o)} download>{o.formato==='dta'?'Stata (.dta)':o.formato.toUpperCase()}</a>)}<a href={enderecoReferencia(m.dicionario)} target="_blank" rel="noreferrer">{t('Dicionário sucinto','Concise dictionary')}</a><Link to={retorno}>{t('Voltar ao painel','Back to dashboard')}</Link></div>
    </>}
  </div>;
}
