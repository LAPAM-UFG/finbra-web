import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { LineSeriesOption } from 'echarts/charts';
import { Grafico, linhas } from './Grafico';
import { Estado } from './Kpi';
import { useSocial } from '../assistencia_dados';
import { condicaoComparacao, nomeTerritorioComparacao, periodoComparacao, pontePontilhadaRais, referenciasComparacao, rupturaComparacao, textoComparacao } from '../comparacoes_apresentacao';
import type { GeografiaComparacao } from '../comparacoes_dados';
import { efetivarSerieRaio, formatarRaio, grupoOrigemRaio, linkComparacaoRaio, obterSerieRaio, type CatalogoRaio, type IndicadorRaio, type PontoRaio, type RetratoRaio } from '../raio_x';
import { idioma, local, t } from '../idioma';
import { exportar, type Tabela } from '../exportar';
import { indicadorHistoricoCadunico, linkHistoricoCadunico } from '../cadunico_historico';

export default function DetalheRaioX({c,g,r,i,p,ressalvas,ano}:{c:CatalogoRaio;g:GeografiaComparacao;r:RetratoRaio;i:IndicadorRaio;p:PontoRaio|null;ressalvas:boolean;ano:number|null}) {
  const id=useId();const original=grupoOrigemRaio(g,r.grupo,i)!;
  const refs=['referencias','agropecuaria_original'].includes(i.catalogo)?[]:referenciasComparacao(g,original);
  const keys=[r.grupo,...refs];
  const serie=useSocial(`rx-serie:${c.catalogos[i.catalogo]?.ref.sha256??(i.catalogo==='agropecuaria_original'?c.agropecuaria?.edicao_sha256:c.referencias.arquivo.sha256)}:${i.id}:${r.grupo}:${ressalvas}`,async()=>{
    const resultado=await Promise.allSettled(keys.map(grupo=>obterSerieRaio(c,g,grupo,i)));
    if(resultado[0].status==='rejected')throw resultado[0].reason;
    return resultado.map((v,k)=>v.status==='fulfilled'?{grupo:keys[k],...v.value,serie:efetivarSerieRaio(v.value.serie,ressalvas)}:null);
  });
  const base=serie.dados?.[0];const pp=base?.periodos??[];
  const ultima=(gr:NonNullable<typeof base>)=>{const indices=gr.periodos.map((p,k)=>({p,k})).filter(x=>!ano||(x.p>10000?Math.floor(x.p/100):x.p)===ano);return indices.filter(x=>gr.serie.v[x.k]!==null).at(-1)??indices.at(-1);};
  // Referências territoriais usam exatamente a mesma data do recorte em foco.
  const dataFoco=p?.[0]??(base?ultima(base)?.p:undefined);
  const dados=serie.dados?.filter(x=>x!==null).map(x=>({nome:nomeTerritorioComparacao(g,grupoOrigemRaio(g,x.grupo,i)??x.grupo),valores:pp.map(p=>x.serie.v[x.periodos.indexOf(p)]??null),fonte:x}))??[];
  const tabela=():Tabela=>({colunas:['territorio','indicador','periodo','valor_comparavel','unidade','numerador','denominador','valor_original','condicao','municipios_com_dados'],linhas:dados.flatMap(x=>x.fonte.periodos.map((p,k)=>[x.nome,textoComparacao(i,'nome'),p,x.fonte.serie.v[k],textoComparacao(i,'unidade'),x.fonte.serie.n[k],x.fonte.serie.d[k],x.fonte.serie.r?.[k]??null,condicaoComparacao(x.fonte.serie.c[k]),x.fonte.serie.q[k]])),metadados:[[t('Fonte','Source'),i.fonte_nome],[t('Definição','Definition'),textoComparacao(i,'descricao')],[t('Agregação','Aggregation'),textoComparacao(i,'normalizacao')]]});
  const refAno=p?.[0]?String(p[0]>10000?Math.floor(p[0]/100):p[0]):'';
  const componentes=r.referencias[refAno];
  const usaPopulacaoExtra=i.catalogo==='referencias'&&(i.id==='rx_populacao'||i.id==='rx_pib_hab'||i.id.endsWith('_populacao'));
  const anoBase=i.anos_base_demografica?.[refAno]??(usaPopulacaoExtra?componentes?.[0]:undefined);
  return <div className="rx-detalhe" id={id}>
    <p>{textoComparacao(i,'descricao')}</p>
    <dl className="rx-metadados"><div><dt>{t('Fonte','Source')}</dt><dd>{i.fonte_nome}</dd></div><div><dt>{t('Como comparar','How to compare')}</dt><dd>{textoComparacao(i,'normalizacao')}</dd></div></dl>
    {p&&i.catalogo!=='agropecuaria_original'&&<dl className="rx-metadados"><div><dt>{t('Numerador na referência exibida','Numerator at the displayed date')}</dt><dd>{p[2]?.toLocaleString(local(),{maximumFractionDigits:4})??'—'}</dd></div><div><dt>{t('Denominador na referência exibida','Denominator at the displayed date')}</dt><dd>{p[3]?.toLocaleString(local(),{maximumFractionDigits:4})??'—'}</dd></div></dl>}
    {i.metodo_referencia==='mediana'&&!/^\d{7}$/.test(r.grupo)&&<p className="rx-nota">{t('Referência descritiva: mediana dos municípios com dados. Não é o resultado oficial consolidado do estado ou do Brasil.','Descriptive reference: median of municipalities with data. Not an official consolidated state or national result.')}</p>}
    {textoComparacao(i,'alerta')&&<p className="rx-nota">{textoComparacao(i,'alerta')}</p>}
    {(i.id.includes('rais')||i.id.endsWith('_rais'))&&componentes&&<p className="rx-nota">{t('Massa anual estimada: dezembro × 12, sem 13º imputado. Remuneração declarada:','Estimated yearly payroll: December × 12, with no imputed 13th salary. Reported pay:')} {componentes[1]===null||!componentes[2]?'—':(100*componentes[1]/componentes[2]).toLocaleString(local(),{maximumFractionDigits:1})+'%'}{componentes[1]!==null&&componentes[2]!==null?` (${componentes[1].toLocaleString(local())}/${componentes[2].toLocaleString(local())})`:''}.</p>}
    {anoBase&&String(anoBase)!==refAno&&<p className="rx-nota">{t(`Base demográfica de ${refAno}: ${anoBase} (Censo quando aplicável).`,`${refAno} population reference: ${anoBase} (Census where applicable).`)}</p>}
    {i.frequencia==='mensal'&&<p className="rx-ajuda">{t('Indicador mensal. O filtro anual mostra a última observação daquele ano, sem somar estoques mensais.','Monthly indicator. A year filter shows the last observation within that year; monthly stocks are not added.')}</p>}
    <div className="rx-acoes">{i.fontes.filter(f=>/^https?:\/\//.test(f.url)).map(f=><a key={f.url} href={f.url} target="_blank" rel="noreferrer">{f.nome} ↗</a>)}<Link to={linkComparacaoRaio(i,r.grupo,g,dataFoco)}>{i.catalogo==='agropecuaria_original'?t('Abrir no painel de Agropecuária →','Open in Agriculture dashboard →'):t('Abrir análise e comparações →','Open analysis and comparisons →')}</Link></div>
    {i.catalogo==='assistencia_todas'&&indicadorHistoricoCadunico[i.id]&&<p><Link to={linkHistoricoCadunico(new URLSearchParams({...(/^\d{7}$/.test(r.grupo)?{cod:r.grupo}:{}),...(g.territorios[r.grupo]?.uf?{uf:g.territorios[r.grupo].uf!}:{})}))}>{t('Ver também o histórico recuperado do CadÚnico →','Also see the recovered Cadastro Único history →')}</Link></p>}
    {serie.carregando&&<Estado carregando/>}{serie.erro&&<Estado erro={serie.erro} tentarNovamente={serie.recarregar}/>}
    {base&&<>
      {refs.length>0&&<div className="rx-referencias" aria-label={t('Referências na mesma data','References at the same date')}>
        {dados.map(x=>{const k=x.fonte.periodos.indexOf(dataFoco??0);const v=x.fonte.serie.v[k]??null;return <article key={x.fonte.grupo}><span>{x.nome}</span><strong>{i.binario&&x.fonte.grupo===r.grupo&&/^\d{7}$/.test(r.grupo)?(v===100?t('Sim','Yes'):v===0?t('Não','No'):'—'):formatarRaio(i,v)}</strong><small>{dataFoco?periodoComparacao(dataFoco):'—'} · {textoComparacao(i,'unidade')}</small><small>{k>=0?condicaoComparacao(x.fonte.serie.c[k]):t('Sem dado nesta data','No data for this date')}</small></article>;})}
      </div>}
      {serie.dados?.some(x=>x===null)&&<p role="status">{t('Uma referência não carregou. A série do território foi preservada.','One reference did not load. The territory series is still available.')}</p>}
      <h4>{t('Evolução no tempo','Trend over time')}</h4>
      <p className="rx-ajuda">{i.catalogo==='agropecuaria_original'?t('Série na unidade original. Compare lugares por produtividade e percentuais na aba Agropecuária.','Series in its original unit. Compare places using yields and shares in the Agriculture tab.'):t('Gráfico na unidade comparável do indicador. Lacunas não são preenchidas.','Chart in the comparable indicator unit. Missing data remain blank.')} {i.area==='trabalho'&&t('Pontilhados na RAIS identificam mudanças de método.','Dotted RAIS segments identify methodology changes.')}</p>
      {pp.length>1?<Grafico nome={`raiox_${r.grupo}_${i.id}`} altura={310} descricao={t('Série histórica do indicador e referências territoriais na mesma unidade.','Historical series and territorial references in the same unit.')} opcao={cores=>{
        const eixos=pp.map(periodoComparacao);const op=linhas(eixos,dados,v=>formatarRaio(i,v),[],true)(cores);const paleta=[...cores.series,...cores.comparacao];
        const series=dados.flatMap<LineSeriesOption>((s,k)=>{const estilo={name:s.nome,type:'line' as const,itemStyle:{color:paleta[k]},symbolSize:4,connectNulls:false};
          const partes=pp.slice(1).flatMap((p,j)=>{const v1=s.valores[j],v2=s.valores[j+1];if(v1===null||v2===null)return [];
            const parcial=dados.some(x=>x.fonte.serie.c[x.fonte.periodos.indexOf(p)]===11||x.fonte.serie.c[x.fonte.periodos.indexOf(pp[j])]===11);
            const ruptura=rupturaComparacao(i.area,i,pp[j],p,parcial);const ponte=i.area==='trabalho'&&ruptura==='metodo'&&pontePontilhadaRais(pp[j],p,v1,v2);
            if(ruptura&&!ponte)return [];return [{...estilo,data:[[eixos[j],v1],[eixos[j+1],v2]],symbol:'none',silent:true,tooltip:{show:false},lineStyle:{color:paleta[k],width:2,type:ponte?'dotted' as const:'solid' as const}}];});
          return [{...estilo,data:s.valores,lineStyle:{width:0},emphasis:{lineStyle:{width:0}}},...partes];});
        return {...op,tooltip:{...(op.tooltip as object),confine:true},legend:{type:'scroll',top:0,left:0,right:0,textStyle:{color:cores.tinta2}},grid:{left:8,right:16,top:46,bottom:8,containLabel:true},series};
      }}/>:<p>{t('Retrato único: ainda não há uma série temporal deste indicador.','Single snapshot: no historical series is available for this indicator yet.')}</p>}
      <details className="rx-tabela-serie"><summary>{t('Ver todos os anos, condições e componentes','See all dates, statuses and components')}</summary><div className="rx-rolagem"><table><thead><tr><th>{t('Referência','Reference')}</th><th>{t('Valor comparável','Comparable value')}</th><th>{t('Condição','Status')}</th></tr></thead><tbody>{pp.map((p,k)=><tr key={p}><td>{periodoComparacao(p)}</td><td>{formatarRaio(i,base.serie.v[k])}</td><td>{condicaoComparacao(base.serie.c[k])}</td></tr>)}</tbody></table></div></details>
      <div className="rx-acoes"><span>{t('Baixar série e referências:','Download series and references:')}</span>{(['csv','xlsx'] as const).map(f=><button type="button" className="botao-leve" key={f} onClick={()=>exportar(`raiox_serie_${r.grupo}_${i.id}`,f,tabela(),idioma()==='en'?'.':',')}>{f==='csv'?'CSV':'Excel'}</button>)}</div>
    </>}
  </div>;
}
