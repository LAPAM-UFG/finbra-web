import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import '../educacao.css';
import { Grafico, barras, linhas } from '../components/Grafico';
import { Estado } from '../components/Kpi';
import { exportar, type Tabela } from '../exportar';
import { idioma, local, t } from '../idioma';
import { buscaEntreAreas } from '../navegacao';
import {
  obterMetaEducacao, obterMunicipiosEducacao, obterGrupoEducacao, obterRankingEducacao, linhaEducacao, useEducacao,
  obterBuscaMunicipiosEducacao, filtrarMunicipiosEducacao, municipioExatoEducacao, ufMunicipioEducacao,
  REDES_EDUCACAO, redeEducacaoValida, normalizarBuscaEducacao, avaliacaoEducacao, anoSemEdicaoEducacao, posicoesEducacao,
  type RedeEducacao,
  type MetaEducacao, type GrupoEducacao, type IndicadorEducacao, type TerritorioEducacao,
} from '../educacao_dados';

const nome = (i: IndicadorEducacao) => idioma() === 'en' ? i.nome_en : i.nome;
const descricao = (i: IndicadorEducacao) => idioma() === 'en' ? i.descricao_en : i.descricao;
const NOMES_REDE:Record<RedeEducacao,[string,string]>={todas:['Todas as redes','All school sectors'],publica:['Rede pública','Public schools'],municipal:['Rede municipal','Municipal schools'],estadual:['Rede estadual','State schools'],federal:['Rede federal','Federal schools'],privada:['Rede privada','Private schools']};
const nomeRede=(r:RedeEducacao)=>t(...NOMES_REDE[r]);
const metricas=(m:MetaEducacao)=>m.indicadores.filter(i=>i.unidade!=='condicao');
const ETAPAS:[string,string,string][]=[['','Todas as etapas','All stages'],['infantil','Educação infantil','Early childhood'],['ai','Anos iniciais (Saeb: 5º ano)','Primary (Saeb: grade 5)'],['af','Anos finais (Saeb: 9º ano)','Lower secondary (Saeb: grade 9)'],['medio','Ensino médio','Upper secondary'],['geral','Indicadores gerais','General indicators']];
const correspondeEtapa=(i:IndicadorEducacao,etapa:string)=>!etapa || i.etapa===etapa || (['ai','af'].includes(etapa)&&i.etapa==='fundamental');
const ressalvaSaeb=(code:number|null|undefined)=>code===1 ? t('Média de avaliação estadual usada pelo Inep após extravio de provas do Saeb.','State assessment used by Inep following lost Saeb tests.') : code===2 ? t('Participação inferior a 50% após extravio de provas; resultado com ressalva do Inep.','Participation below 50% following lost tests; result flagged by Inep.') : code===3 ? t('Não divulgado por solicitação.','Withheld on request.') : code===4 ? t('Participantes insuficientes para divulgação.','Insufficient participants for publication.') : code===6 ? t('Pelo menos 20% das provas extraviadas e participação insuficiente para divulgação.','At least 20% of tests lost and insufficient participation for publication.') : '';
const fmt = (i: IndicadorEducacao, v: number | null | undefined) => {
  if(v==null)return t('sem dado','no data');
  const perfil=i.tema==='perfil' && i.unidade==='percentual';
  if(perfil && v>0 && v<0.01)return '<'+(0.01).toLocaleString(local(),{minimumFractionDigits:2})+'%';
  if(perfil && v<100 && v>99.99)return '>'+(99.99).toLocaleString(local(),{minimumFractionDigits:2})+'%';
  if(i.unidade==='condicao')return i.rotulos?.[String(v)] ?? String(v);
  return v.toLocaleString(local(),{maximumFractionDigits:i.unidade==='numero' ? 0 : perfil || i.unidade==='pontos' ? 2 : 1,minimumFractionDigits:perfil || i.unidade==='pontos' ? 2 : i.unidade==='indice' ? 1 : 0})+(i.unidade==='percentual' ? '%' : '');
};
const TEMAS: [string, string, string, string, string][] = [
  ['matriculas','Matrículas e etapas','Enrolments and stages','Escolas localizadas no território, em todas as redes. Educação profissional e especial podem se sobrepor às etapas.','Schools located in the territory, across all sectors. Vocational and special education can overlap other stages.'],
  ['perfil','Perfil das matrículas','Enrolment profile','Sexo e cor/raça registrados no Censo, em todas as redes. Percentuais sobre todas as matrículas da educação básica do mesmo ano e território, incluindo cor/raça não declarada. Matrículas não são pessoas únicas.','Sex and race/colour recorded in the Census, across all sectors. Percentages use all basic education enrolments in the same year and territory, including unreported race/colour. Enrolments are not unique people.'],
  ['redes','Redes de ensino','School sectors','Matrículas nas redes municipal, estadual, federal e privada. Rede pública reúne as três primeiras.','Enrolments in municipal, state, federal and private schools. Public education combines the first three.'],
  ['integral','Tempo integral','Full-time education','Matrículas em jornada integral na educação infantil, no ensino fundamental e no médio.','Full-time enrolments in preschool, primary and secondary education.'],
  ['escolas','Rede de escolas','School network','Contagem de escolas em funcionamento e com matrículas na educação básica.','Operating schools with basic education enrolments.'],
  ['docentes','Docentes e turmas','Teaching positions and classes','Docentes são somados por escola: quem atua em duas escolas conta duas vezes. As etapas de atuação podem se sobrepor. Turmas são contadas nas escolas de todas as redes.','Teacher counts are summed across schools: a teacher working in two schools counts twice. Teaching stages can overlap. Classes are counted across all school sectors.'],
  ['inclusao','Inclusão escolar','Inclusive education','Educação especial em classes comuns e exclusivas, em todas as redes. O percentual usa somente matrículas da educação especial; não mede a prevalência de deficiência.','Special education in mainstream and exclusive classes, across all sectors. The percentage uses special education enrolments only; it does not measure disability prevalence.'],
  ['infraestrutura','Condições das escolas públicas','Conditions in public schools','Percentuais entre escolas públicas com resposta válida para cada item.','Percentages among public schools with valid answers for each item.'],
  ['trajetoria','Trajetória dos alunos','Student progression','Aprovação, reprovação, abandono e atraso escolar. Resultados oficiais da rede pública.','Pass, repetition, dropout and age-grade distortion. Official public school results.'],
  ['aprendizagem','Aprendizagem · Ideb e Saeb','Learning · Ideb and Saeb','Ideb: índice de 0 a 10. Português e Matemática do Saeb: pontos da escala oficial, por etapa; não são percentuais. Divulgação bienal. As redes e os anos aparecem nos cartões.','Ideb: 0–10 index. Saeb Portuguese and Mathematics: official scale points by stage, not percentages. Published every two years; cards show their sector and year.'],
];
type Ctx = { meta: MetaEducacao; grupo: GrupoEducacao; territorio: TerritorioEducacao; ano: number | null; rede:RedeEducacao; comparacoes:{nome:string;dados?:GrupoEducacao}[]; sp: URLSearchParams; mudar: (x: Record<string, string | null>) => void; link: (path: string, extra?: Record<string, string>) => string };

function Carregando({ erro, tentar }: { erro?: string; tentar: () => void }) {
  return <Estado erro={erro} carregando={!erro} mensagem={erro ? t('Não foi possível carregar os indicadores de educação.', 'Could not load education indicators.') : t('Carregando os indicadores de educação…', 'Loading education indicators…')} tentarNovamente={tentar} />;
}
function BuscaMunicipio({uf,cod,items,onEscolher}:{uf:string;cod:string;items?:TerritorioEducacao[];onEscolher:(codigo:string)=>void}) {
  const id=useId(),[busca,setBusca]=useState(''),query=busca.trim(),ativa=query.length>=2;
  const nacional=useEducacao(ativa ? 'busca-municipios' : null,obterBuscaMunicipiosEducacao);
  const matches=useMemo(()=>filtrarMunicipiosEducacao(ativa ? nacional.dados ?? [] : query ? [] : items ?? [],query),[ativa,nacional.dados,items,query]);
  const visiveis=ativa ? matches.slice(0,100) : matches;
  const escolher=(code:string)=>{setBusca('');onEscolher(code);};
  return <div className="ed-campo-municipio"><label htmlFor={id}>{t('Município','Municipality')}</label>
    <input id={id} type="search" aria-label={t('Buscar município','Search municipality')} placeholder={t('Nome ou código IBGE, em qualquer estado…','Name or IBGE code, in any state…')} value={busca} onChange={e=>setBusca(e.target.value)} onKeyDown={e=>{
      if(e.key==='Escape')setBusca('');
      if(e.key==='Enter' && ativa){e.preventDefault();const match=municipioExatoEducacao(matches,query);if(match)escolher(match.grupo);}
    }} />
    <select aria-label={t('Município','Municipality')} value={query ? '' : cod} onChange={e=>escolher(e.target.value)}>
      <option value="">{ativa ? t('Selecione um dos municípios encontrados','Select a matching municipality') : uf ? t('Todos os municípios do estado','All municipalities in the state') : t('Brasil · todos os municípios','Brazil · all municipalities')}</option>
      {visiveis.map(x=><option key={x.grupo} value={x.grupo}>{x.nome} · {x.uf} · {x.grupo}{x.grupo==='2605459' ? t(' (distrito estadual)',' (state district)') : ''}</option>)}
    </select>
    <small className="ed-busca-ajuda" role="status">{ativa && !nacional.dados && !nacional.erro ? t('Carregando a busca nacional…','Loading national search…') : nacional.erro ? t('A busca não carregou. Tente novamente ou escolha um estado.','Search could not load. Retry or choose a state.') : ativa && !matches.length ? t('Nenhum município encontrado. Confira o nome ou código.','No matching municipality. Check the name or code.') : ativa ? t(`${matches.length} município(s) encontrado(s)${matches.length>100 ? '; mostrando os primeiros 100. Refine a busca.' : '. Escolha na lista ou pressione Enter para um resultado exato.'}`,`${matches.length} matching municipalities${matches.length>100 ? '; showing the first 100. Refine your search.' : '. Choose from the list or press Enter for an exact match.'}`) : t('Busque em todo o Brasil; o estado é opcional. Use ao menos dois caracteres.','Search across Brazil; the state is optional. Type at least two characters.')}</small>
    {ativa && nacional.erro && <button type="button" onClick={nacional.recarregar}>{t('Repetir busca','Retry search')}</button>}
  </div>;
}
function EducacaoBase({ pagina, historico = false, children }: { pagina: string; historico?: boolean; children: (c: Ctx) => ReactNode }) {
  const [sp,setSp] = useSearchParams();
  const redeRaw=sp.get('rede')??'todas',rede=redeEducacaoValida(redeRaw)?redeRaw:'todas';
  const meta = useEducacao('meta:'+rede, ()=>obterMetaEducacao(rede));
  const ufRaw = (sp.get('uf') ?? '').trim().toUpperCase();
  const codeRaw = (sp.get('cod') ?? sp.get('ente') ?? '').trim();
  const brasilExplicito = codeRaw.toUpperCase() === 'BR';
  const code = brasilExplicito ? '' : codeRaw;
  const codeUf = code === '53' || code === '5300108' ? 'DF' : meta.dados && /^\d{7}$/.test(code) ? Object.keys(meta.dados.municipios).find(u => u === ufRaw) ?? null : null;
  // O código municipal permite inferir a UF mesmo quando o endereço vem sem uf.
  const UF_COD: Record<string,string> = {11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF'};
  const uf = ufRaw || codeUf || UF_COD[code.slice(0,2)] || '';
  const municipios = useEducacao(meta.dados && uf && meta.dados.municipios[uf] ? `municipios:${rede}:${uf}` : null, () => obterMunicipiosEducacao(uf,rede));
  const cod = code === '53' ? '5300108' : /^\d{2}$/.test(code) && UF_COD[code] ? '' : code;
  const territorio = meta.dados && (cod ? municipios.dados?.find(x => x.grupo === cod) : meta.dados.territorios.find(x => x.grupo === (uf || 'BR')));
  const pedido = historico ? null : sp.get('ano'); const anoPedido = pedido && /^\d{4}$/.test(pedido) ? Number(pedido) : null;
  const foraDaBase = anoPedido !== null && meta.dados && !meta.dados.anos.includes(anoPedido);
  const ano = foraDaBase ? Math.max(...meta.dados!.anos) : anoPedido;
  const erroFiltro = meta.dados && (!redeEducacaoValida(redeRaw) || (ufRaw && !meta.dados.municipios[ufRaw]) || (brasilExplicito && ufRaw) || (ufRaw && UF_COD[code.slice(0,2)] && ufRaw !== UF_COD[code.slice(0,2)]) || (pedido && !/^\d{4}$/.test(pedido)) || (cod && (!/^\d{7}$/.test(cod) || !uf)) || (cod && municipios.dados && !territorio));
  const grupo = useEducacao(territorio ? `grupo:${rede}:${territorio.grupo}` : null, () => obterGrupoEducacao(territorio!,rede));
  const tUf=territorio?.nivel==='M' && uf!=='DF' ? meta.dados?.territorios.find(x=>x.grupo===uf) : undefined;
  const tBr=territorio && territorio.nivel!=='BR' ? meta.dados?.territorios.find(x=>x.grupo==='BR') : undefined;
  const compUf=useEducacao(tUf ? `comp:${rede}:${uf}` : null,()=>obterGrupoEducacao(tUf!,rede));
  const compBr=useEducacao(tBr ? `comp:${rede}:BR` : null,()=>obterGrupoEducacao(tBr!,rede));
  const mudar = (x: Record<string,string|null>) => { const q = new URLSearchParams(sp); q.delete('ente'); for (const [k,v] of Object.entries(x)) { if (v) q.set(k,v); else q.delete(k); } setSp(q); };
  const link = (path: string, extra?: Record<string,string>) => { const financeiro = path.endsWith('/financiamento') || path.endsWith('/profissionais'); const q = new URLSearchParams(financeiro ? buscaEntreAreas(sp.toString(),'educacao','financas') : sp); for (const [k,v] of Object.entries(extra ?? {})) q.set(k,v); return `${path}${q.size ? '?'+q.toString() : ''}`; };
  if (!meta.dados) return <Carregando erro={meta.erro} tentar={meta.recarregar} />;
  const m = meta.dados;
  return <div className="ed-painel">
    <h2>{pagina}</h2>
    <p className="ed-intro">{t('Matrículas, escolas, trajetória e aprendizagem. Os números já estão prontos: escolha o lugar e explore.', 'Enrolments, schools, student progression and learning. The figures are ready: choose a place and explore.')}</p>
    <div className="ed-filtros" aria-label={t('Filtros de educação','Education filters')}>
      <label>{t('Estado (opcional)','State (optional)')}<select aria-label={t('Estado','State')} value={uf in m.municipios ? uf : ''} onChange={e => mudar({uf:e.target.value,cod:null})}>
        <option value="">{t('Brasil · todos os estados','Brazil · all states')}</option>{m.territorios.filter(x=>x.nivel==='UF').map(x=><option value={x.grupo} key={x.grupo}>{x.nome}</option>)}
      </select></label>
      <BuscaMunicipio key={uf} uf={uf} cod={cod} items={municipios.dados} onEscolher={code=>mudar({cod:code || null,...(code ? {uf:ufMunicipioEducacao(code) ?? null} : {})})} />
      <label>{t('Rede de ensino','School sector')}<select aria-label={t('Rede de ensino','School sector')} value={rede} onChange={e=>mudar({rede:e.target.value==='todas'?null:e.target.value})}>{REDES_EDUCACAO.filter(r=>r==='todas'||m.redes?.[r]).map(r=><option key={r} value={r}>{nomeRede(r)}</option>)}</select></label>
      {!historico && <label>{t('Ano de referência','Reference year')}<select aria-label={t('Ano de referência','Reference year')} value={pedido ?? ''} onChange={e=>mudar({ano:e.target.value})}>
        <option value="">{t('Último ano de cada indicador','Latest year for each indicator')}</option>{foraDaBase && <option value={anoPedido!}>{anoPedido}</option>}{[...m.anos].reverse().map(y=><option value={y} key={y}>{y}</option>)}
      </select></label>}
    </div>
    {erroFiltro ? <div className="ed-nota" role="alert">{t('O território ou ano do endereço é inválido. Ajuste os filtros para continuar.','The territory or year in the link is invalid. Adjust the filters to continue.')} <button onClick={()=>setSp({})}>{t('Mostrar Brasil','Show Brazil')}</button></div>
      : !territorio || !grupo.dados ? <Carregando erro={municipios.erro ?? grupo.erro} tentar={()=>{municipios.recarregar();grupo.recarregar();}} />
      : <>
        <p className="ed-ref"><strong>{territorio.nome}{territorio.grupo==='2605459' ? t(' (distrito estadual)',' (state district)') : ''}{territorio.nivel==='M' ? ` · ${territorio.uf}` : ''}</strong> · {historico ? `${m.anos[0]}–${m.anos[m.anos.length-1]}` : ano ?? t('última referência disponível por indicador','latest available reference for each indicator')}</p>
        {foraDaBase && <p className="ed-nota" role="status">{t(`O ano de ${anoPedido} não está em nenhuma fonte de educação do painel; a página mostra ${ano}, o mais recente.`,`The year ${anoPedido} is not available in any education source in this dashboard; the page shows ${ano}, the latest year.`)}</p>}
        <p className="ed-escopo">{nomeRede(rede)}{rede==='todas' && <> · {t('Censo: todas as redes; taxas, Ideb e Saeb: rede pública, salvo indicação.','Census: all sectors; rates, Ideb and Saeb: public schools unless stated.')}</>}</p>
        {children({meta:m,grupo:grupo.dados,territorio,ano,rede,comparacoes:[...(tUf?[{nome:uf,dados:compUf.dados}]:[]),...(tBr?[{nome:'Brasil',dados:compBr.dados}]:[])],sp,mudar,link})}
      </>}
  </div>;
}

const unidadeEducacao=(i:IndicadorEducacao)=>i.unidade==='percentual' ? '%' : i.unidade==='indice' ? t('índice 0–10','0–10 index') : i.unidade==='pontos' ? t('pontos na escala Saeb','Saeb scale points') : i.unidade==='condicao' ? t('condição do resultado','result status') : i.id.startsWith('doc_') ? t('vínculos docente–escola','school teaching positions') : i.id.startsWith('tur_') ? t('turmas','classes') : i.id.startsWith('escolas') ? t('escolas','schools') : t('matrículas','enrolments');
const fonteIndicador=(c:Ctx,i:IndicadorEducacao)=>i.fonte==='censo' ? 'Censo Escolar' : `${i.fonte==='saeb'?'Saeb':i.fonte==='ideb'?'Ideb':'Inep'} · ${i.rede==='estadual'?nomeRede('estadual'):nomeRede(c.rede==='todas'?'publica':c.rede)}`;
const rawAno=(c:Ctx,ano:number)=>c.grupo.linhas.find(r=>r[0]===ano);
function flagSaeb(c:Ctx,i:IndicadorEducacao,row:(number|null)[]|undefined) {
  const index=c.meta.indicadores.findIndex(x=>x.id===i.id+'_nota');return row && index>=0 ? row[index+1] : null;
}
function motivoAusente(c:Ctx,i:IndicadorEducacao,ano:number|null) {
  if(anoSemEdicaoEducacao(c.meta,i,ano))return t(`Não houve edição do ${i.fonte==='saeb'?'Saeb':'Ideb'} em ${ano}.`,`No ${i.fonte==='saeb'?'Saeb':'Ideb'} edition in ${ano}.`);
  const flag=ano===null?null:flagSaeb(c,i,rawAno(c,ano));
  return ressalvaSaeb(flag)||t('O Inep não divulgou valor para esta rede, etapa e território. Ausência não significa zero.','Inep has not published a value for this sector, stage and territory. Missing does not mean zero.');
}
function AvisoEdicao({c,i}:{c:Ctx;i:IndicadorEducacao}) {
  if(!anoSemEdicaoEducacao(c.meta,i,c.ano))return null;
  return <div className="ed-nota" role="status"><p>{motivoAusente(c,i,c.ano)} {t('Escolha uma edição disponível; o ano pedido foi mantido.','Choose an available edition; your requested year has been retained.')}</p><div className="ed-acoes">{(c.meta.edicoes_avaliacao??i.anos).slice(-4).map(y=><button key={y} onClick={()=>c.mudar({ano:String(y)})}>{y}</button>)}</div></div>;
}
function Variacao({c,i,ano,valor}:{c:Ctx;i:IndicadorEducacao;ano:number;valor:number}) {
  const index=c.meta.indicadores.indexOf(i),before=[...c.grupo.linhas].reverse().find(r=>(r[0] as number)<ano && r[index+1]!==null);
  if(!before)return null;
  if(i.fonte==='saeb' && [flagSaeb(c,i,before),flagSaeb(c,i,rawAno(c,ano))].some(v=>v===1||v===2))return null;
  const previous=before[index+1] as number,delta=valor-previous;
  const change=i.unidade==='numero' && previous>0 ? 100*delta/previous : delta;
  const unit=i.unidade==='percentual' ? ' p.p.' : i.unidade==='numero' ? previous>0 ? '%' : '' : t(' pontos',' points');
  return <small className="ed-variacao">{change>0?'+':''}{change.toLocaleString(local(),{maximumFractionDigits:2})}{unit} {t(`em relação a ${before[0]}`,`vs ${before[0]}`)}</small>;
}
function Comparacoes({c,i,ano}:{c:Ctx;i:IndicadorEducacao;ano:number}) {
  if(i.unidade==='numero'||!c.comparacoes.length)return null;
  if(i.fonte==='saeb' && [1,2].includes(flagSaeb(c,i,rawAno(c,ano))??0))return null;
  const index=c.meta.indicadores.indexOf(i);
  return <div className="ed-comparacoes" aria-label={t('Referências do mesmo ano e rede','References for the same year and sector')}>{c.comparacoes.map(x=>{
    const r=x.dados?linhaEducacao(x.dados,index,ano):null;
    const status=c.meta.indicadores.findIndex(v=>v.id===i.id+'_nota'),raw=x.dados?.linhas.find(v=>v[0]===ano),marcado=status>=0&&[1,2].includes(raw?.[status+1]??0);
    return <span key={x.nome}>{x.nome==='Brasil'?t('Brasil','Brazil'):x.nome}: <strong>{marcado?t('com ressalva do Inep','flagged by Inep'):x.dados?fmt(i,r?.valor):'…'}</strong></span>;
  })}<small>{ano} · {t('mesma rede e etapa','same sector and stage')}</small></div>;
}
function Cartao({ c, i, resumo=false }: { c: Ctx; i: IndicadorEducacao;resumo?:boolean }) {
  const index=c.meta.indicadores.indexOf(i),row=linhaEducacao(c.grupo,index,c.ano),ano=row?.ano??c.ano;
  const cov=row && c.grupo.cobertura[String(row.ano)]?.[i.id],flag=row?flagSaeb(c,i,rawAno(c,row.ano)):null;
  const marcado=flag===1||flag===2,selecionado=c.sp.get('ind')===i.id;
  return <article className={`ed-card${selecionado?' ed-selecionado':''}`} id={(resumo?'ed-resumo-':'ed-ind-')+i.id}>
    <h4>{nome(i)}</h4><div className={`ed-valor${row?.valor==null?' ed-sem':''}`}>{fmt(i,row?.valor)}{marcado && '*'}</div>
    <span className="ed-ref">{ano??'—'} · {fonteIndicador(c,i)} · {unidadeEducacao(i)}</span>
    {row?.valor!=null && <Variacao c={c} i={i} ano={row.ano} valor={row.valor} />}
    {row?.valor==null && <p className="ed-ausencia">{motivoAusente(c,i,ano)}</p>}
    {marcado && <p className="ed-ausencia">* {ressalvaSaeb(flag)}</p>}
    {row?.valor!=null && <Comparacoes c={c} i={i} ano={row.ano} />}
    <details><summary>{t('Entenda o indicador','Understand this indicator')}</summary><p>{descricao(i)}</p>{cov && <p>{t(`${cov[0].toLocaleString(local())} escolas com o item, entre ${cov[1].toLocaleString(local())} escolas públicas com resposta válida.`,`${cov[0].toLocaleString(local())} schools reporting the item, among ${cov[1].toLocaleString(local())} public schools with a valid answer.`)}</p>}</details>
    <div className="ed-links"><Link aria-label={t(`Evolução de ${nome(i)}`,`Trend for ${nome(i)}`)} to={c.link('/educacao/evolucao',{ind:i.id})}>{t('Evolução','Trend')}</Link><Link aria-label={t(`Ranking de ${nome(i)}`,`Ranking for ${nome(i)}`)} to={c.link('/educacao/rankings',{ind:i.id,...(row?{ano:String(row.ano)}:{})})}>Ranking</Link><Link aria-label={t(`Tabela de ${nome(i)}`,`Table for ${nome(i)}`)} to={c.link('/educacao/tabela',{ind:i.id})}>{t('Tabela','Table')}</Link></div>
  </article>;
}
function imagemEducacao(c:Ctx,titulo:string,periodo:string,i?:IndicadorEducacao) {
  const rede=i&&i.fonte!=='censo'?(i.rede==='estadual'?'estadual':c.rede==='todas'?'publica':c.rede):c.rede;
  return {titulo,contexto:`${c.territorio.nome} · ${nomeRede(rede)} · ${periodo}`,fonte:i?`${t('Fonte','Source')}: ${fonteIndicador(c,i)} · ${unidadeEducacao(i)}`:t('Fonte: Inep. Escolas localizadas no território.','Source: Inep. Schools located in the territory.')};
}
function GraficosResumo({ c }: { c: Ctx }) {
  const total=c.meta.indicadores.find(i=>i.id==='mat_total')!,index=c.meta.indicadores.indexOf(total);
  const reference=c.ano??linhaEducacao(c.grupo,index,null)?.ano??null,rows=c.grupo.linhas.filter(r=>reference===null||(r[0] as number)<=reference);
  const sectors=[['mat_municipal',t('Municipal','Municipal')],['mat_estadual',t('Estadual','State')],['mat_federal',t('Federal','Federal')],['mat_privada',t('Privada','Private')]];
  return <div className="ed-graficos"><section className="ed-grafico"><h3>{t('Evolução das matrículas','Enrolment trends')}</h3><p className="ed-ref">{nomeRede(c.rede)} · Censo Escolar</p>
    <Grafico animacao={false} nome={`${c.territorio.nome}_matriculas_${c.rede}`} altura={220} metadadosImagem={imagemEducacao(c,t('Evolução das matrículas','Enrolment trends'),`${rows[0]?.[0]??'—'}–${reference??'—'}`)} opcao={linhas(rows.map(r=>r[0] as number),[{nome:nome(total),valores:rows.map(r=>r[index+1])}],v=>fmt(total,v))} /></section>
    {c.rede==='todas' && <section className="ed-grafico"><h3>{t('Matrículas por rede de ensino','Enrolments by school sector')}</h3><p className="ed-ref">{reference??'—'} · Censo Escolar</p><Grafico animacao={false} nome={`${c.territorio.nome}_redes_${reference}`} altura={220} metadadosImagem={imagemEducacao(c,t('Matrículas por rede de ensino','Enrolments by school sector'),String(reference??'—'))} opcao={barras(sectors.map(([,label])=>label),sectors.map(([id])=>linhaEducacao(c.grupo,c.meta.indicadores.findIndex(i=>i.id===id),reference)?.valor??null),v=>fmt(total,v))} /></section>}
  </div>;
}
function PainelConteudo({c}:{c:Ctx}) {
  const [busca,setBusca]=useState(''),[perfilPct,setPerfilPct]=useState(true);
  const [abertas,setAbertas]=useState<Set<string>>(()=>new Set(['matriculas',location.hash.slice(1),c.meta.indicadores.find(i=>i.id===c.sp.get('ind'))?.tema??'']));
  const etapa=c.sp.get('etapa')??'',q=normalizarBuscaEducacao(busca);
  const items=metricas(c.meta).filter(i=>!(c.rede!=='todas' && (i.rede==='estadual'||i.tema==='redes')) && correspondeEtapa(i,etapa) && (!q||normalizarBuscaEducacao(`${nome(i)} ${i.variavel} ${descricao(i)}`).includes(q)));
  useEffect(()=>{if(location.hash.startsWith('#ed-ind-'))requestAnimationFrame(()=>document.getElementById(location.hash.slice(1))?.scrollIntoView({block:'start'}));},[c.grupo.grupo,c.rede]);
  return <>
    <nav className="ed-indice" aria-label={t('Índice de indicadores','Indicator index')}>{TEMAS.filter(([id])=>items.some(i=>i.tema===id)).map(([id,pt,en])=><a href={'#'+id} key={id} onClick={()=>setAbertas(v=>new Set([...v,id]))}>{t(pt,en)}</a>)}</nav>
    <div className="ed-cards ed-resumo">{['mat_total','escolas','integral_pct','ideb_ai'].map(id=><Cartao c={c} i={c.meta.indicadores.find(i=>i.id===id)!} key={id} resumo />)}</div>
    <p className="ed-nota">{t('Matrículas são registros de escolarização, não pessoas únicas. Os dados representam as escolas do território. Compare percentuais, índices e proficiências no mesmo ano, rede e etapa.','Enrolments are schooling records, not unique people. Data describe schools located in the territory. Compare percentages, indices and proficiency scores for the same year, sector and stage.')}</p>
    <div className="ed-escolha"><label>{t('Encontrar um indicador','Find an indicator')}<input type="search" aria-label={t('Buscar indicador no painel','Search dashboard indicators')} placeholder={t('Ex.: português, raça, água…','E.g. Portuguese, race, water…')} value={busca} onChange={e=>setBusca(e.target.value)} /></label><label>{t('Etapa dos indicadores','Indicator stage')}<select value={etapa} onChange={e=>c.mudar({etapa:e.target.value||null})}>{ETAPAS.map(([id,pt,en])=><option key={id} value={id}>{t(pt,en)}</option>)}</select></label></div>
    <div className="ed-acoes"><button onClick={()=>setAbertas(new Set(TEMAS.map(x=>x[0])))}>{t('Abrir todas as seções','Expand all sections')}</button><button onClick={()=>setAbertas(new Set())}>{t('Recolher seções','Collapse sections')}</button><span className="ed-ref">{t(`${items.length} indicadores disponíveis neste filtro`,`Available indicators in this filter: ${items.length}`)}</span></div>
    {!items.length && <p role="status">{t('Nenhum indicador encontrado. Ajuste a palavra ou a etapa.','No matching indicators. Try another word or stage.')}</p>}
    {TEMAS.map(([id,pt,en,nota,notaEn])=>{
      const list=items.filter(i=>i.tema===id && (id!=='perfil'||(i.unidade==='percentual')===perfilPct));if(!list.length)return null;
      const aberta=!!q || abertas.has(id);
      return <section className="ed-secao" id={id} key={id}><h3><button className="ed-titulo-secao" aria-expanded={aberta} aria-controls={'ed-secao-'+id} onClick={()=>setAbertas(v=>{const s=new Set(v);if(s.has(id))s.delete(id);else s.add(id);return s;})}>{aberta?'▾':'▸'} {t(pt,en)} <span>{list.length}</span></button></h3>
        {aberta && <div id={'ed-secao-'+id}><p>{c.rede==='todas'?t(nota,notaEn):t('Indicadores da rede selecionada. Consulte em cada cartão a etapa, a fonte e o ano.','Indicators for the selected sector. Each card shows its stage, source and year.')}</p>
          {id==='perfil' && <div className="ed-acoes" role="group" aria-label={t('Medida do perfil','Profile measure')}><button aria-pressed={perfilPct} onClick={()=>setPerfilPct(true)}>{t('Percentuais','Percentages')}</button><button aria-pressed={!perfilPct} onClick={()=>setPerfilPct(false)}>{t('Matrículas','Enrolments')}</button></div>}
          {id==='aprendizagem' && <p className="ed-nota">{t('Resultados com * têm ressalva na planilha do Inep. Os códigos de condição acompanham o Saeb nos downloads e na API. A edição de 2021 requer atenção ao contexto da pandemia e à participação.','Results marked * carry a caveat in the Inep spreadsheet. Saeb status codes are included in downloads and the API. Interpret the 2021 edition in light of pandemic conditions and participation.')}</p>}
          <div className="ed-cards">{list.map(i=><Cartao key={i.id} c={c} i={i} />)}</div></div>}
      </section>;
    })}
    <details className="ed-secao"><summary>{t('Ver gráficos gerais de matrículas','View general enrolment charts')}</summary><GraficosResumo c={c} /></details>
    <p className="ed-nota">{t('O financiamento e os profissionais do SIOPE descrevem o governo, enquanto o Censo descreve as escolas do território.','SIOPE funding and staff describe the government, while the School Census describes schools located in the territory.')} <Link to={c.link('/educacao/financiamento')}>{t('Ver financiamento · SIOPE','View funding · SIOPE')}</Link></p>
    <Link to={`/downloads?area=educacao${c.territorio.uf?'&uf='+c.territorio.uf:''}${c.rede!=='todas'?'&rede='+c.rede:''}`}>{t('Baixar os dados de educação · Stata, R, CSV e Parquet','Download education data · Stata, R, CSV and Parquet')}</Link>
  </>;
}
export function EducacaoPainel() {return <EducacaoBase pagina={t('Retrato da educação','Education at a glance')}>{c=><PainelConteudo c={c}/>}</EducacaoBase>;}

function Seletor({ c }: { c: Ctx }) {
  const [busca,setBusca]=useState(''),id=c.sp.get('ind')??'mat_total',q=normalizarBuscaEducacao(busca);
  const items=metricas(c.meta).filter(i=>!(c.rede!=='todas' && i.rede==='estadual') && (i.id===id||!q||normalizarBuscaEducacao(`${nome(i)} ${i.variavel}`).includes(q)));
  return <><label>{t('Buscar indicador','Find an indicator')}<input type="search" value={busca} placeholder={t('Nome ou código da variável…','Name or variable code…')} onChange={e=>setBusca(e.target.value)} /></label><label>{t('Indicador','Indicator')}<select aria-label={t('Indicador','Indicator')} value={items.some(i=>i.id===id)?id:''} onChange={e=>c.mudar({ind:e.target.value})}><option disabled value="">{t('Escolha um indicador','Choose an indicator')}</option>{TEMAS.map(([tema,pt,en])=>{const list=items.filter(i=>i.tema===tema);return list.length?<optgroup label={t(pt,en)} key={tema}>{list.map(i=><option key={i.id} value={i.id}>{nome(i)}</option>)}</optgroup>:null;})}</select></label></>;
}
function escolhido(c: Ctx) { return metricas(c.meta).find(i=>i.id===(c.sp.get('ind')??'mat_total')); }
function condicaoLinha(c:Ctx,i:IndicadorEducacao,r:(number|null)[]) {
  if(anoSemEdicaoEducacao(c.meta,i,r[0]))return t('Ano sem edição','Year without an edition');
  const note=ressalvaSaeb(flagSaeb(c,i,r));if(note)return note;
  const value=r[c.meta.indicadores.indexOf(i)+1];return value==null?t('Não divulgado ou indisponível','Unpublished or unavailable'):value===0?t('Zero registrado','Recorded zero'):t('Registrado','Recorded');
}
function exportarSerie(c:Ctx,formato:'csv'|'xlsx',todos=false) {
  const selected=escolhido(c);const inds=todos?c.meta.indicadores:selected?[selected,...c.meta.indicadores.filter(i=>i.associado===selected.id)]:[];
  const tab:Tabela={colunas:['cod_ibge','territorio','uf','ano',...inds.map(i=>i.variavel),...(!todos&&selected?['condicao_dado']:[])],
    linhas:c.grupo.linhas.map(r=>[c.territorio.cod_ibge,c.territorio.nome,c.territorio.uf,r[0],...inds.map(i=>r[c.meta.indicadores.indexOf(i)+1]),...(!todos&&selected?[condicaoLinha(c,selected,r)]:[])]),
    metadados:[[t('Fonte','Source'),'Inep · Censo Escolar, taxas, Ideb e Saeb'],[t('Rede','School sector'),nomeRede(c.rede)],[t('Referência da edição de dados','Data edition timestamp'),c.meta.gerado_em],...inds.map((i):[string,string]=>[i.variavel,descricao(i)+' · '+unidadeEducacao(i)])]};
  exportar(`educacao_${c.territorio.grupo}_${c.rede}`,formato,tab,idioma()==='en'?'.':',');
}
function Serie({c,tabela=false}:{c:Ctx;tabela?:boolean}) {
  const i=escolhido(c);
  if(!i)return <><div className="ed-escolha"><Seletor c={c}/></div><p role="alert">{t('Indicador inválido. Escolha um indicador acima.','Invalid indicator. Choose one above.')}</p></>;
  const index=c.meta.indicadores.indexOf(i),rows=c.grupo.linhas.filter(r=>!anoSemEdicaoEducacao(c.meta,i,r[0]));
  const flagged=rows.some(r=>[1,2].includes(flagSaeb(c,i,r)??0));
  const serie=[{nome:nome(i),valores:rows.map(r=>[1,2].includes(flagSaeb(c,i,r)??0)?null:r[index+1])},...(flagged?[{nome:t('Resultado com ressalva do Inep','Result flagged by Inep'),valores:rows.map(r=>[1,2].includes(flagSaeb(c,i,r)??0)?r[index+1]:null)}]:[])];
  return <><div className="ed-escolha"><Seletor c={c}/></div><p className="ed-nota">{descricao(i)}</p><div className="ed-destaque-indicador"><Cartao c={c} i={i}/></div>
    {!tabela && <Grafico animacao={false} nome={`${c.territorio.nome}_${i.id}_${c.rede}`} descricao={descricao(i)} metadadosImagem={imagemEducacao(c,nome(i),`${c.meta.anos[0]}–${c.meta.anos.at(-1)}`,i)} opcao={linhas(rows.map(r=>r[0] as number),serie,v=>fmt(i,v))} />}
    {avaliacaoEducacao(i) && <p className="ed-ref">{t('O gráfico usa apenas anos de edição. Ausências dentro de uma edição continuam como lacunas. Resultados com ressalva são identificados separadamente.','The chart uses edition years only. Missing results within an edition remain gaps. Flagged results are identified separately.')}</p>}
    <div className="ed-acoes"><button onClick={()=>exportarSerie(c,'csv')}>CSV</button><button onClick={()=>exportarSerie(c,'xlsx')}>Excel</button><button onClick={()=>exportarSerie(c,'csv',true)}>{t('Todos os indicadores · CSV','All indicators · CSV')}</button></div>
    <div className="ed-tabela" tabIndex={0} role="region" aria-label={t('Série histórica','Time series')}><table><caption>{nome(i)} · {c.territorio.nome} · {nomeRede(c.rede)}</caption><thead><tr><th>{t('Ano','Year')}</th><th>{t('Valor','Value')}</th><th>{t('Condição do dado','Data status')}</th></tr></thead><tbody>{c.grupo.linhas.map(r=><tr key={r[0]}><td>{r[0]}</td><td>{fmt(i,r[index+1])}{[1,2].includes(flagSaeb(c,i,r)??0)&&'*'}</td><td className="ed-condicao">{condicaoLinha(c,i,r)}</td></tr>)}</tbody></table></div>
  </>;
}
export function EducacaoEvolucao(){return <EducacaoBase pagina={t('Evolução dos indicadores','Indicator trends')} historico>{c=><Serie c={c}/>}</EducacaoBase>;}
export function EducacaoTabela(){return <EducacaoBase pagina={t('Tabela e exportações','Table and downloads')} historico>{c=><Serie c={c} tabela/>}</EducacaoBase>;}
function Ranking({c}:{c:Ctx}) {
  const i=escolhido(c),[limite,setLimite]=useState(25),[ordem,setOrdem]=useState('desc'),[busca,setBusca]=useState(''),[incluirRessalvas,setIncluirRessalvas]=useState(false);
  const year=c.ano??(i?.anos.length?Math.max(...i.anos):null),semEdicao=!!i&&anoSemEdicaoEducacao(c.meta,i,year);
  const dados=useEducacao(year&&i&&!semEdicao?`ranking:${c.rede}:${year}`:null,()=>obterRankingEducacao(year!,c.rede));
  const index=i?c.meta.indicadores.indexOf(i):-1,statusIndex=i?c.meta.indicadores.findIndex(x=>x.id===i.id+'_nota'):-1;
  const rows=useMemo(()=>dados.dados&&i?dados.dados.linhas.filter(r=>(!c.territorio.uf||r[2]===c.territorio.uf)&&r[index+3]!=null&&(statusIndex<0||incluirRessalvas||r[statusIndex+3]===0)).sort((a,b)=>{const av=a[index+3] as number,bv=b[index+3] as number;return (ordem==='asc'?av-bv:bv-av)||a[0]-b[0];}):[],[dados.dados,i,c.territorio.uf,index,ordem,statusIndex,incluirRessalvas]);
  const positions=useMemo(()=>posicoesEducacao(rows,index),[rows,index]),own=rows.findIndex(r=>String(r[0])===c.territorio.grupo),q=normalizarBuscaEducacao(busca);
  const visible=rows.map((r,n)=>({r,pos:positions[n]})).filter(({r})=>!q||normalizarBuscaEducacao(`${r[0]} ${r[1]} ${r[2]}`).includes(q));
  const propria=dados.dados?.linhas.find(r=>String(r[0])===c.territorio.grupo),propriaMarcada=statusIndex>=0&&[1,2].includes((propria?.[statusIndex+3] as number)??0);
  const ressalvados=statusIndex>=0?(dados.dados?.linhas??[]).filter(r=>(!c.territorio.uf||r[2]===c.territorio.uf)&&r[index+3]!=null&&r[statusIndex+3]!==0).length:0;
  const baixar=()=>{if(!i)return;const tab:Tabela={colunas:['posicao','cod_ibge','municipio','uf','ano',i.variavel,...(statusIndex>=0?[i.variavel+'_nota']:[])],linhas:rows.map((r,n)=>[positions[n],r[0],r[1],r[2],year,r[index+3],...(statusIndex>=0?[r[statusIndex+3]]:[])]),metadados:[[t('Fonte','Source'),'Inep'],[t('Rede','School sector'),nomeRede(c.rede)],[t('Indicador','Indicator'),descricao(i)],[t('Posições','Positions'),t('Empates compartilham a posição. CSV contém todo o recorte, sem o filtro de busca da tela.','Ties share a position. CSV includes the full scope, without the on-screen search filter.')]]};exportar(`ranking_educacao_${c.rede}`,'csv',tab,idioma()==='en'?'.':',');};
  return <><div className="ed-escolha"><Seletor c={c}/><label>{t('Ordenação','Order')}<select value={ordem} onChange={e=>{setOrdem(e.target.value);setLimite(25);}}><option value="desc">{t('Maiores valores primeiro','Highest values first')}</option><option value="asc">{t('Menores valores primeiro','Lowest values first')}</option></select></label></div>
    {!i?<p role="alert">{t('Escolha um indicador válido.','Choose a valid indicator.')}</p>:<><p className="ed-nota">{descricao(i)} {t('A posição ordena valores; não é uma avaliação geral da qualidade da educação. Empates compartilham posição.','Positions sort values, not overall education quality. Ties share a position.')}</p>
    {semEdicao?<AvisoEdicao c={{...c,ano:year}} i={i}/>:!dados.dados?<Carregando erro={dados.erro} tentar={dados.recarregar}/>:<>
      {i.fonte==='saeb'&&<div className="ed-nota"><label><input type="checkbox" checked={incluirRessalvas} onChange={e=>{setIncluirRessalvas(e.target.checked);setLimite(25);}}/>{t(' Incluir resultados com ressalva do Inep',' Include results flagged by Inep')}</label><p>{t(`${ressalvados} resultados com ressalva neste recorte. Por padrão, ficam fora do ranking regular; as notas continuam disponíveis nas séries e nos arquivos.`,`${ressalvados} flagged results in this scope. By default they are outside the regular ranking; scores remain available in series and files.`)}</p></div>}
      <p>{year} · {rows.length.toLocaleString(local())} {t('municípios com valor divulgado','municipalities with published values')}</p>
      {c.territorio.nivel==='M' && <div className="ed-posicao" role="status"><strong>{c.territorio.nome}</strong>{own>=0?<><span>{fmt(i,rows[own][index+3] as number|null)} · {t(`${positions[own]}º de ${rows.length}`,`${positions[own]} of ${rows.length}`)}</span><Comparacoes c={c} i={i} ano={year!}/></>:<span>{propriaMarcada&&!incluirRessalvas?t('Resultado com ressalva do Inep: fora do ranking regular. Ative a opção acima para incluí-lo.','Result flagged by Inep: outside the regular ranking. Enable the option above to include it.'):t('Sem resultado divulgado neste ano e rede; não há posição atribuída.','No published result for this year and sector; no position assigned.')}</span>}</div>}
      {!rows.length?<p className="ed-nota">{t('Não há resultados publicados para este recorte e rede. Confira os anos disponíveis e a metodologia da fonte.','No published results for this scope and sector. Check available years and source methodology.')}</p>:<><div className="ed-escolha"><label>{t('Encontrar município no ranking','Find a municipality in the ranking')}<input type="search" value={busca} placeholder={t('Nome ou código IBGE','Name or IBGE code')} onChange={e=>{setBusca(e.target.value);setLimite(25);}} /></label><button onClick={baixar}>{t('Baixar ranking · CSV','Download ranking · CSV')}</button></div>
      <div className="ed-tabela" tabIndex={0}><table><caption>{nome(i)} · {nomeRede(c.rede)} · {year}</caption><thead><tr><th>#</th><th>{t('Município','Municipality')}</th><th>{t('Valor','Value')}</th></tr></thead><tbody>{visible.slice(0,limite).map(({r,pos})=><tr key={r[0]} className={String(r[0])===c.territorio.grupo?'ed-linha-selecionada':undefined}><td>{pos}</td><td><Link to={`/educacao?uf=${r[2]}&cod=${r[0]}&ano=${year}&rede=${c.rede}&ind=${i.id}#ed-ind-${i.id}`}>{r[1]} · {r[2]}</Link></td><td>{fmt(i,r[index+3] as number|null)}{statusIndex>=0&&[1,2].includes((r[statusIndex+3] as number|null)??0)&&'*'}</td></tr>)}</tbody></table></div>
      {!visible.length && <p role="status">{t('Nenhum município corresponde à busca.','No matching municipalities.')}</p>}{visible.length>limite&&<button onClick={()=>setLimite(v=>v+50)}>{t('Mostrar mais 50','Show 50 more')}</button>}
      {i.fonte==='saeb'&&<p className="ed-ref">{t('* Resultado com ressalva do Inep: avaliação estadual substituta ou participação inferior a 50% por extravio de provas. Consulte a condição na tabela ou no CSV.','* Result flagged by Inep: substituted state assessment or participation below 50% following lost tests. Check the status in the table or CSV.')}</p>}</>}
    </>}</>}
  </>;
}
export function EducacaoRankings(){return <EducacaoBase pagina={t('Rankings municipais de educação','Municipal education rankings')}>{c=><Ranking c={c}/>}</EducacaoBase>;}
function Metodologia({c}:{c:Ctx}) {
  const [busca,setBusca]=useState(''),[tema,setTema]=useState(''),q=normalizarBuscaEducacao(busca);
  const items=c.meta.indicadores.filter(i=>(!tema||i.tema===tema)&&(!q||normalizarBuscaEducacao(`${nome(i)} ${i.variavel} ${descricao(i)}`).includes(q)));
  return <><p>{t('Cobertura desde 2013. Cada número mantém o ano, a rede e os vazios da fonte, sem interpolação. As contagens são de escolas localizadas no território, não necessariamente da residência dos alunos.','Coverage since 2013. Each value retains its source year, school sector and missing values, without interpolation. Counts refer to school location, which may differ from student residence.')}</p>
    <ul>{Object.values(c.meta.fontes).map(f=><li key={f.nome}><a href={f.url} target="_blank" rel="noreferrer">Inep · {f.nome}</a></li>)}</ul>
    <p>{t('UF e Brasil: contagens somadas e percentuais como razão das somas. Taxas de trajetória, Ideb e Saeb são os resultados oficiais do próprio recorte, nunca médias de notas municipais. No recorte Todas as redes, os resultados de trajetória e aprendizagem se referem à rede pública, salvo indicação.','States and Brazil: summed counts and ratios of sums. Progression rates, Ideb and Saeb are official results for the area itself, never averages of municipal scores. In All sectors, progression and learning results refer to public schools unless stated.')}</p>
    <p className="ed-nota">{t('Ideb usa escala de 0 a 10. Saeb usa pontos da escala de proficiência, por disciplina e etapa. Ausência não é zero; ano sem edição não é falha de coleta. Asteriscos e códigos de condição preservam as ressalvas do Inep.','Ideb uses a 0–10 scale. Saeb uses proficiency-scale points by subject and stage. Missing is not zero; a year without an edition is not a collection failure. Asterisks and status codes retain Inep caveats.')}</p>
    <p>{t('Docentes são contados por escola: quem atua em duas conta duas vezes. Matrículas também não são pessoas únicas. Brasília usa 5300108; Fernando de Noronha é distrito estadual. Infraestrutura considera escolas públicas da rede selecionada com resposta válida. Todas as redes reúne as públicas; na rede privada, esses indicadores ficam sem resultado.','Teachers are counted by school: someone working in two counts twice. Enrolments are also not unique people. Brasília uses 5300108; Fernando de Noronha is a state district. Infrastructure refers to public schools in the selected sector with valid answers. All sectors combines public schools; private-sector infrastructure is not available.')}</p>
    <div className="ed-escolha"><label>{t('Buscar no dicionário','Search dictionary')}<input type="search" value={busca} onChange={e=>setBusca(e.target.value)} placeholder={t('Variável, assunto ou palavra…','Variable, topic or word…')}/></label><label>{t('Tema','Topic')}<select value={tema} onChange={e=>setTema(e.target.value)}><option value="">{t('Todos os temas','All topics')}</option>{[...TEMAS,['qualidade','Condição do resultado','Result status']].map(([id,pt,en])=><option key={id} value={id}>{t(pt,en)}</option>)}</select></label></div>
    <p role="status">{items.length} {t('variáveis encontradas','matching variables')}</p>
    <div className="ed-dicionario">{items.map(i=>{const index=c.meta.indicadores.indexOf(i),anos=c.grupo.linhas.filter(r=>r[index+1]!==null).map(r=>r[0]);return <details key={i.id} className="ed-dic-item"><summary><strong>{nome(i)}</strong><code>{i.variavel}</code><span>{unidadeEducacao(i)}</span></summary><p>{descricao(i)}</p><p><strong>{t('Anos observados neste recorte: ','Observed years in this scope: ')}</strong>{anos.join(', ')||t('Sem divulgação','No published values')}</p><p>{t('Fonte: ','Source: ')}{c.meta.fontes[i.fonte]?.nome}</p></details>;})}</div>
    <Link to={`/downloads?area=educacao${c.territorio.uf?'&uf='+c.territorio.uf:''}${c.rede!=='todas'?'&rede='+c.rede:''}`}>{t('Dados, dicionário e API para R/Stata','Data, dictionary and API for R/Stata')}</Link>
  </>;
}
export function EducacaoMetodologia(){return <EducacaoBase pagina={t('Fontes e metodologia','Sources and methodology')} historico>{c=><Metodologia c={c}/>}</EducacaoBase>;}
