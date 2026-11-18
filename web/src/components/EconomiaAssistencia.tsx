import { useEffect, useId } from 'react';
import { Link } from 'react-router-dom';
import { useSocial } from '../assistencia_dados';
import { exportar, type Tabela } from '../exportar';
import { idioma, local, t } from '../idioma';
import { reais, reaisExato } from '../format';
import { BASES_REFERENCIA, compararReferencia, condicaoReferencia, enderecoReferencia, formatarReferencia, nomeBase, nomeDenominador, notaReferencia, obterMetaReferencias, obterSerieReferencias, ultimoAnoReferencia, type AnoReferencia, type BaseReferencia } from '../assistencia_referencias';
import { Estado } from './Kpi';
import { AjudaAssistencia } from './AjudaAssistencia';

const TIPOS=['pbf','bpc','total'] as const;
const nome=(tipo:typeof TIPOS[number])=>tipo==='pbf'?'Bolsa Família / Auxílio Brasil':tipo==='bpc'?'BPC':t('Os dois programas','Both programmes');
export const condicaoEconomia=(c:number)=>condicaoReferencia(c,'pib');
const cobertura=(l:AnoReferencia|undefined)=>l&&l[8]!==null&&l[9]!==null&&l[9]>0?100*l[8]/l[9]:null;

export function EconomiaAssistencia({grupo,uf,nomeTerritorio,anoPedido,basePedido,alterar}:{grupo:string;uf:string|null;nomeTerritorio:string;anoPedido:string|null;basePedido?:string|null;alterar:(m:Record<string,string|null>)=>void}) {
  const id=useId();
  const base:BaseReferencia=BASES_REFERENCIA.includes(basePedido as BaseReferencia)?basePedido as BaseReferencia:'populacao';
  const meta=useSocial('referencias-meta',obterMetaReferencias);
  const dados=useSocial(`referencias:${grupo}:${uf}`,()=>obterSerieReferencias(grupo,uf));
  const estado=useSocial(uf&&grupo!==uf?`referencias:${uf}`:null,()=>obterSerieReferencias(uf!,uf));
  const brasil=useSocial(grupo!=='BR'?'referencias:BR':null,()=>obterSerieReferencias('BR',null));
  const m=meta.dados;
  const anoValido=!!m&&!!anoPedido&&/^\d{4}$/.test(anoPedido)&&m.anos.includes(Number(anoPedido));
  const ano=anoValido?Number(anoPedido):m?ultimoAnoReferencia(m,base):undefined;
  const l=dados.dados?.linhas.find(r=>r[0]===ano);
  useEffect(()=>{if(!dados.dados||window.location.hash!=='#pagamentos-pib')return;const f=requestAnimationFrame(()=>document.getElementById('pagamentos-pib')?.scrollIntoView({block:'start'}));return()=>cancelAnimationFrame(f);},[dados.dados]);
  const comp=(row:AnoReferencia|undefined,tipo:typeof TIPOS[number],rotulo:string)=>{const c=compararReferencia(row,tipo,base);return `${rotulo}: ${c.valor===null?condicaoReferencia(c.condicao,base):formatarReferencia(c.valor,base)}`;};
  const tabela=():Tabela=>({
    colunas:['territorio','ano','programa','pagamentos_nominais','meses_validos','populacao','ano_populacao','pib_nominal','massa_rais_anual_estimada','vinculos_remuneracao_informada','vinculos_ativos','pagamentos_por_habitante','pagamentos_rais_pct','pagamentos_pib_pct','condicao_populacao','condicao_rais','condicao_pib'],
    linhas:(dados.dados?.linhas??[]).flatMap(row=>TIPOS.map(tipo=>{const p=compararReferencia(row,tipo,'populacao'),r=compararReferencia(row,tipo,'rais'),g=compararReferencia(row,tipo,'pib');return[nomeTerritorio,row[0],nome(tipo),p.pago,p.meses,row[6],row[10],row[1],row[7],row[8],row[9],p.valor,r.valor,g.valor,condicaoReferencia(p.condicao,'populacao'),condicaoReferencia(r.condicao,'rais'),condicaoReferencia(g.condicao,'pib')];})),
    metadados:[[t('Cálculo por habitante','Per-resident calculation'),notaReferencia('populacao')],[t('Estimativa RAIS','RAIS estimate'),notaReferencia('rais')],[t('Cálculo PIB','GDP calculation'),notaReferencia('pib')],[t('Fontes','Sources'),'CGU; MTE/RAIS; IBGE; LAPAM/UFG'],[t('Cobertura','Coverage'),t('Pagamentos anuais exigem 12 meses válidos, sem estimar meses ausentes. PBF/Auxílio Brasil não inclui o Benefício Extraordinário de 2021–2023. BPC inclui retroativos presentes no total.','Yearly payments require 12 valid months; missing months are not estimated. PBF/Auxílio Brasil excludes the extraordinary benefit in 2021–2023. BPC includes retroactive amounts already in the total.')]],
  });
  const den=l?(base==='populacao'?l[6]:base==='rais'?l[7]:l[1]):null;
  const cov=cobertura(l);
  return <section id="pagamentos-pib" className="cartao as-economia" aria-labelledby={`${id}-titulo`}>
    <h3 id={`${id}-titulo`}>{t('Como comparar os pagamentos?','How do the payments compare?')}</h3>
    <p className="as-resumo">{t('Escolha uma referência para Bolsa Família e BPC. Os valores anuais já estão prontos e independem do filtro mensal acima.','Choose a reference for Bolsa Família and BPC. Yearly figures are ready and independent of the monthly filter above.')}</p>
    {(meta.carregando||dados.carregando)&&<Estado carregando/>}
    {(meta.erro||dados.erro)&&<Estado erro={meta.erro||dados.erro||''} tentarNovamente={()=>{meta.recarregar();dados.recarregar();}}/>}
    {m&&dados.dados&&<>
      <div className="as-economia-filtros">
        <div className="as-economia-filtro"><label htmlFor={`${id}-base`}>{t('Referência da comparação','Comparison reference')}</label><select id={`${id}-base`} value={base} onChange={e=>alterar({base_comparacao:e.target.value,ano_comparacao:null,ano_pib:null})}>{BASES_REFERENCIA.map(b=><option key={b} value={b}>{nomeBase(b)}</option>)}</select></div>
        <div className="as-economia-filtro"><label htmlFor={`${id}-ano`}>{t('Ano da comparação','Comparison year')}</label><select id={`${id}-ano`} value={ano} onChange={e=>alterar({ano_comparacao:e.target.value,ano_pib:null})}>{[...m.anos].reverse().map(y=><option key={y} value={y}>{y}{!m.anos_com_valor[base].includes(y)?t(' · sem comparação completa',' · no complete comparison'):''}</option>)}</select></div>
      </div>
      {anoPedido&&!anoValido&&<p role="status">{t(`Ano inválido. Mostrando ${ano}.`,`Invalid year. Showing ${ano}.`)}</p>}
      <p className="as-recorte">{nomeTerritorio} · {ano} · {nomeDenominador(base)}: {den===null||den===undefined?t('indisponível','unavailable'):base==='populacao'?den.toLocaleString(local()):reais(den)}</p>
      {base==='rais'&&<div className="as-referencia-nota"><strong>{t('Estimativa anual: massa de dezembro × 12','Yearly estimate: December payroll × 12')}</strong><p>{notaReferencia(base)}</p><p>{t('Remuneração informada em dezembro','Reported December pay')}: {cov===null?'—':`${cov.toLocaleString(local(),{maximumFractionDigits:1})}%`} · {l?.[8]?.toLocaleString(local())??'—'} / {l?.[9]?.toLocaleString(local())??'—'} {t('vínculos ativos','active jobs')}. {cov!==null&&cov<100&&t('Parte dos vínculos não tem remuneração válida informada; a relação pode refletir essa cobertura.','Some jobs have no valid reported pay; the ratio may reflect this coverage.')}</p></div>}
      {base==='populacao'&&l?.[10]&&<p className="as-resumo">{t('Base populacional','Population base')}: {l[10]} · {l[10]===2022?t('Censo IBGE','IBGE Census'):t('estimativa populacional IBGE','IBGE population estimate')}{l[10]!==ano?` · ${t('ano da população difere do ano dos pagamentos','population year differs from payment year')}`:''}.</p>}
      <div className="as-economia-kpis">{TIPOS.map(tipo=>{const x=compararReferencia(l,tipo,base);return <div className="as-kpi as-economia-kpi" key={tipo}>
        <div className="as-economia-cab"><span className="as-kpi-rot">{nome(tipo)} · {nomeBase(base)}</span><AjudaAssistencia rotulo={t(`Explicação: ${nome(tipo)} · ${nomeBase(base)}`,`Explanation: ${nome(tipo)} · ${nomeBase(base)}`)}><p>{notaReferencia(base)}</p><p>{t('Exige 12 meses válidos e denominador positivo. O total exige ambos os programas completos. Ausência permanece sem valor.','Requires 12 valid months and a positive denominator. Both programmes must be complete for the combined figure. Missing data stay missing.')}</p></AjudaAssistencia></div>
        <span className="as-kpi-val">{x.valor===null?condicaoReferencia(x.condicao,base):formatarReferencia(x.valor,base)}</span>
        <span className="as-kpi-cmp">{t('Pagamentos no ano','Yearly payments')}: {x.pago===null?'—':reais(x.pago)} · {x.meses}/12 {t('meses válidos','valid months')}</span>
        {base==='rais'&&<span className="as-kpi-cmp">{t('Percentual sobre massa salarial estimada','Percentage of estimated payroll')}</span>}
        {estado.dados&&<span className="as-kpi-cmp">{comp(estado.dados.linhas.find(r=>r[0]===ano),tipo,uf!)}</span>}
        {brasil.dados&&<span className="as-kpi-cmp">{comp(brasil.dados.linhas.find(r=>r[0]===ano),tipo,t('Brasil','Brazil'))}</span>}
        <Link className="as-ranking-pib-link" aria-label={t(`Ranking e mapa: ${nome(tipo)} · ${nomeBase(base)}`, `Ranking and map: ${nome(tipo)} · ${nomeBase(base)}`)} to={`/assistencia/comparacoes-pagamentos?${new URLSearchParams({base_comparacao:base,medida:tipo,ano_comparacao:String(ano),...(uf?{uf}:{}),...(/^\d{7}$/.test(grupo)?{cod:grupo}:{})})}`}>{t('Ver ranking e mapa','View ranking and map')}</Link>
      </div>;})}</div>
      {base!=='rais'&&<p className="as-resumo">{notaReferencia(base)}</p>}
      <p className="as-resumo">{t('A série Bolsa Família/Auxílio Brasil não inclui o Benefício Extraordinário (2021–2023). BPC inclui retroativos já presentes no total. As relações não medem impacto causal nem participação dos benefícios na renda de todos os moradores.','The Bolsa Família/Auxílio Brasil series excludes the extraordinary benefit (2021–2023). BPC includes retroactive amounts already in the total. Ratios do not measure causal effects or benefits’ share of all residents’ income.')}</p>
      <details><summary>{t('Ver todos os anos e valores usados','See all years and underlying amounts')}</summary><div className="as-tabela-rolagem"><table className="as-tabela"><caption>{nomeTerritorio} · {nomeBase(base)}</caption><thead><tr><th>{t('Ano','Year')}</th><th>{nomeDenominador(base)}</th><th>Bolsa Família / Auxílio Brasil</th><th>BPC</th><th>{t('Os dois programas','Both programmes')}</th></tr></thead><tbody>{dados.dados.linhas.map(row=><tr key={row[0]}><th>{row[0]}</th><td>{row[base==='populacao'?6:base==='rais'?7:1]===null?'—':base==='populacao'?row[6]!.toLocaleString(local()):reaisExato(row[base==='rais'?7:1]!)}</td>{TIPOS.map(tipo=>{const x=compararReferencia(row,tipo,base);return <td key={tipo}>{formatarReferencia(x.valor,base)}<small className="as-ranking-pib-codigo">{x.valor===null?condicaoReferencia(x.condicao,base):x.pago===null?'—':reaisExato(x.pago)} · {x.meses}/12</small></td>;})}</tr>)}</tbody></table></div></details>
      <div className="as-acoes"><span>{t('Baixar as três comparações deste recorte:','Download all three comparisons for this scope:')}</span>{(['csv','xlsx'] as const).map(f=><button key={f} className="botao-leve" onClick={()=>exportar(`assistencia_comparacoes_${grupo}`,f,tabela(),idioma()==='en'?'.':',')}>{f==='csv'?'CSV':'Excel'}</button>)}</div>
      <div className="as-acoes"><span>{t('Base municipal completa das comparações:','Complete municipal comparison dataset:')}</span>{m.downloads.map(o=><a className="botao-leve" key={o.formato} href={enderecoReferencia(o)} download>{o.formato==='dta'?'Stata (.dta)':o.formato.toUpperCase()}</a>)}<a href={enderecoReferencia(m.dicionario)} target="_blank" rel="noreferrer">{t('Dicionário sucinto','Concise dictionary')}</a><Link to="/downloads?area=assistencia">{t('Outras bases e API para R e Stata','Other datasets and API for R and Stata')}</Link></div>
    </>}
  </section>;
}
