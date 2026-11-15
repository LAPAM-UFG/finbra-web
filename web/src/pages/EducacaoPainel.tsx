import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import '../educacao.css';
import { Grafico, barras, linhas } from '../components/Grafico';
import { Estado } from '../components/Kpi';
import { exportar, type Tabela } from '../exportar';
import { idioma, local, t } from '../idioma';
import { buscaEntreAreas } from '../navegacao';
import {
  obterMetaEducacao, obterMunicipiosEducacao, obterGrupoEducacao, obterRankingEducacao, linhaEducacao, useEducacao,
  type MetaEducacao, type GrupoEducacao, type IndicadorEducacao, type TerritorioEducacao,
} from '../educacao_dados';

const nome = (i: IndicadorEducacao) => idioma() === 'en' ? i.nome_en : i.nome;
const descricao = (i: IndicadorEducacao) => idioma() === 'en' ? i.descricao_en : i.descricao;
const fmt = (i: IndicadorEducacao, v: number | null | undefined) => v == null ? t('sem dado', 'no data') : v.toLocaleString(local(), { maximumFractionDigits: i.unidade === 'numero' ? 0 : 1, minimumFractionDigits: i.unidade === 'indice' ? 1 : 0 }) + (i.unidade === 'percentual' ? '%' : '');
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const TEMAS: [string, string, string, string, string][] = [
  ['matriculas','Matrículas e etapas','Enrolments and stages','Escolas localizadas no território, em todas as redes. Educação profissional e especial podem se sobrepor às etapas.','Schools located in the territory, across all sectors. Vocational and special education can overlap other stages.'],
  ['perfil','Perfil das matrículas','Enrolment profile','Sexo e cor/raça registrados no Censo, em todas as redes. Matrículas não são pessoas únicas. Cor/raça não declarada é uma categoria, não um valor ausente.','Sex and race/colour recorded in the Census, across all sectors. Enrolments are not unique people. Unreported race/colour is a category, not a missing value.'],
  ['redes','Redes de ensino','School sectors','Matrículas nas redes municipal, estadual, federal e privada. Rede pública reúne as três primeiras.','Enrolments in municipal, state, federal and private schools. Public education combines the first three.'],
  ['integral','Tempo integral','Full-time education','Matrículas em jornada integral na educação infantil, no ensino fundamental e no médio.','Full-time enrolments in preschool, primary and secondary education.'],
  ['escolas','Rede de escolas','School network','Contagem de escolas em funcionamento e com matrículas na educação básica.','Operating schools with basic education enrolments.'],
  ['docentes','Docentes e turmas','Teaching positions and classes','Docentes são somados por escola: quem atua em duas escolas conta duas vezes. As etapas de atuação podem se sobrepor. Turmas são contadas nas escolas de todas as redes.','Teacher counts are summed across schools: a teacher working in two schools counts twice. Teaching stages can overlap. Classes are counted across all school sectors.'],
  ['inclusao','Inclusão escolar','Inclusive education','Educação especial em classes comuns e exclusivas, em todas as redes. O percentual usa somente matrículas da educação especial; não mede a prevalência de deficiência.','Special education in mainstream and exclusive classes, across all sectors. The percentage uses special education enrolments only; it does not measure disability prevalence.'],
  ['infraestrutura','Condições das escolas públicas','Conditions in public schools','Percentuais entre escolas públicas com resposta válida para cada item.','Percentages among public schools with valid answers for each item.'],
  ['trajetoria','Trajetória dos alunos','Student progression','Aprovação, reprovação, abandono e atraso escolar. Resultados oficiais da rede pública.','Pass, repetition, dropout and age-grade distortion. Official public school results.'],
  ['aprendizagem','Aprendizagem · Ideb','Learning · Ideb','Índice de 0 a 10, divulgado a cada dois anos. Rede pública e, em medida separada, rede estadual no ensino médio. Ausência de divulgação não equivale a zero.','Index from 0 to 10, published every two years. Public schools and, as a separate measure, state upper secondary schools. An unpublished result is not zero.'],
];
type Ctx = { meta: MetaEducacao; grupo: GrupoEducacao; territorio: TerritorioEducacao; ano: number | null; sp: URLSearchParams; mudar: (x: Record<string, string | null>) => void; link: (path: string, extra?: Record<string, string>) => string };

function Carregando({ erro, tentar }: { erro?: string; tentar: () => void }) {
  return <Estado erro={erro} carregando={!erro} mensagem={erro ? t('Não foi possível carregar os indicadores de educação.', 'Could not load education indicators.') : t('Carregando os indicadores de educação…', 'Loading education indicators…')} tentarNovamente={tentar} />;
}
function EducacaoBase({ pagina, historico = false, children }: { pagina: string; historico?: boolean; children: (c: Ctx) => ReactNode }) {
  const [sp,setSp] = useSearchParams(); const [busca,setBusca] = useState('');
  const meta = useEducacao('meta', obterMetaEducacao);
  const ufRaw = (sp.get('uf') ?? '').trim().toUpperCase();
  const codeRaw = (sp.get('cod') ?? sp.get('ente') ?? '').trim();
  const brasilExplicito = codeRaw.toUpperCase() === 'BR';
  const code = brasilExplicito ? '' : codeRaw;
  const codeUf = code === '53' || code === '5300108' ? 'DF' : meta.dados && /^\d{7}$/.test(code) ? Object.keys(meta.dados.municipios).find(u => u === ufRaw) ?? null : null;
  // O código municipal permite inferir a UF mesmo quando o endereço vem sem uf.
  const UF_COD: Record<string,string> = {11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF'};
  const uf = ufRaw || codeUf || UF_COD[code.slice(0,2)] || '';
  const municipios = useEducacao(meta.dados && uf && meta.dados.municipios[uf] ? `municipios:${uf}` : null, () => obterMunicipiosEducacao(uf));
  const cod = code === '53' ? '5300108' : /^\d{2}$/.test(code) && UF_COD[code] ? '' : code;
  const territorio = meta.dados && (cod ? municipios.dados?.find(x => x.grupo === cod) : meta.dados.territorios.find(x => x.grupo === (uf || 'BR')));
  const pedido = historico ? null : sp.get('ano'); const anoPedido = pedido && /^\d{4}$/.test(pedido) ? Number(pedido) : null;
  const foraDaBase = anoPedido !== null && meta.dados && !meta.dados.anos.includes(anoPedido);
  const ano = foraDaBase ? Math.max(...meta.dados!.anos) : anoPedido;
  const erroFiltro = meta.dados && ((ufRaw && !meta.dados.municipios[ufRaw]) || (brasilExplicito && ufRaw) || (ufRaw && UF_COD[code.slice(0,2)] && ufRaw !== UF_COD[code.slice(0,2)]) || (pedido && !/^\d{4}$/.test(pedido)) || (cod && (!/^\d{7}$/.test(cod) || !uf)) || (cod && municipios.dados && !territorio));
  const grupo = useEducacao(territorio ? `grupo:${territorio.grupo}` : null, () => obterGrupoEducacao(territorio!));
  const mudar = (x: Record<string,string|null>) => { const q = new URLSearchParams(sp); q.delete('ente'); for (const [k,v] of Object.entries(x)) { if (v) q.set(k,v); else q.delete(k); } setSp(q); };
  const link = (path: string, extra?: Record<string,string>) => { const financeiro = path.endsWith('/financiamento') || path.endsWith('/profissionais'); const q = new URLSearchParams(financeiro ? buscaEntreAreas(sp.toString(),'educacao','financas') : sp); for (const [k,v] of Object.entries(extra ?? {})) q.set(k,v); return `${path}${q.size ? '?'+q.toString() : ''}`; };
  if (!meta.dados) return <Carregando erro={meta.erro} tentar={meta.recarregar} />;
  const m = meta.dados;
  return <div className="ed-painel">
    <h2>{pagina}</h2>
    <p className="ed-intro">{t('Matrículas, escolas, trajetória e aprendizagem. Os números já estão prontos: escolha o lugar e explore.', 'Enrolments, schools, student progression and learning. The figures are ready: choose a place and explore.')}</p>
    <div className="ed-filtros" aria-label={t('Filtros de educação','Education filters')}>
      <label>{t('Estado','State')}<select aria-label={t('Estado','State')} value={uf in m.municipios ? uf : ''} onChange={e => {setBusca('');mudar({uf:e.target.value,cod:null});}}>
        <option value="">{t('Brasil · todos os estados','Brazil · all states')}</option>{m.territorios.filter(x=>x.nivel==='UF').map(x=><option value={x.grupo} key={x.grupo}>{x.nome}</option>)}
      </select></label>
      <label>{t('Município','Municipality')}{uf && <input type="search" aria-label={t('Buscar município','Search municipality')} placeholder={t('Buscar pelo nome…','Search by name…')} value={busca} onChange={e=>setBusca(e.target.value)} />}
        <select aria-label={t('Município','Municipality')} value={territorio?.nivel==='M' ? territorio.grupo : ''} disabled={!uf || !municipios.dados} onChange={e=>mudar({cod:e.target.value})}>
          <option value="">{uf ? t('Todos os municípios do estado','All municipalities in the state') : t('Escolha um estado para ver os municípios','Choose a state to see its municipalities')}</option>
          {municipios.dados?.filter(x=>x.grupo===cod || normal(x.nome).includes(normal(busca))).map(x=><option key={x.grupo} value={x.grupo}>{x.nome}{x.grupo==='2605459' ? t(' (distrito estadual)',' (state district)') : ''}</option>)}
        </select></label>
      {!historico && <label>{t('Ano de referência','Reference year')}<select aria-label={t('Ano de referência','Reference year')} value={pedido ?? ''} onChange={e=>mudar({ano:e.target.value})}>
        <option value="">{t('Último ano de cada indicador','Latest year for each indicator')}</option>{foraDaBase && <option value={anoPedido!}>{anoPedido}</option>}{[...m.anos].reverse().map(y=><option value={y} key={y}>{y}</option>)}
      </select></label>}
    </div>
    {erroFiltro ? <div className="ed-nota" role="alert">{t('O território ou ano do endereço é inválido. Ajuste os filtros para continuar.','The territory or year in the link is invalid. Adjust the filters to continue.')} <button onClick={()=>setSp({})}>{t('Mostrar Brasil','Show Brazil')}</button></div>
      : !territorio || !grupo.dados ? <Carregando erro={municipios.erro ?? grupo.erro} tentar={()=>{municipios.recarregar();grupo.recarregar();}} />
      : <>
        <p className="ed-ref"><strong>{territorio.nome}{territorio.grupo==='2605459' ? t(' (distrito estadual)',' (state district)') : ''}{territorio.nivel==='M' ? ` · ${territorio.uf}` : ''}</strong> · {historico ? `${m.anos[0]}–${m.anos[m.anos.length-1]}` : ano ?? t('última referência disponível por indicador','latest available reference for each indicator')}</p>
        {foraDaBase && <p className="ed-nota" role="status">{t(`O ano de ${anoPedido} não está em nenhuma fonte de educação do painel; a página mostra ${ano}, o mais recente.`,`The year ${anoPedido} is not available in any education source in this dashboard; the page shows ${ano}, the latest year.`)}</p>}
        {children({meta:m,grupo:grupo.dados,territorio,ano,sp,mudar,link})}
      </>}
  </div>;
}

function Cartao({ c, i }: { c: Ctx; i: IndicadorEducacao }) {
  const index = c.meta.indicadores.indexOf(i); const row = linhaEducacao(c.grupo,index,c.ano);
  const cov = row && c.grupo.cobertura[String(row.ano)]?.[i.id];
  const unidade = i.unidade==='numero' ? i.id.startsWith('mat_') ? t('matrículas','enrolments') : i.id.startsWith('doc_') ? t('vínculos docente–escola','school teaching positions') : i.id.startsWith('tur_') ? t('turmas','classes') : i.id.startsWith('escolas') ? t('escolas','schools') : '' : '';
  return <article className="ed-card">
    <h4>{nome(i)}</h4><div className={`ed-valor${row?.valor == null ? ' ed-sem' : ''}`}>{fmt(i,row?.valor)}</div>
    <span className="ed-ref">{row ? row.ano : c.ano ?? '—'} · {i.fonte==='censo' ? t('Censo Escolar','School Census') : i.rede==='estadual' ? t('Rede estadual','State schools') : t('Rede pública','Public schools')}{unidade ? ` · ${unidade}` : ''}{i.unidade==='indice' ? ' · 0–10' : ''}</span>
    <details><summary>{t('Entenda o indicador','Understand this indicator')}</summary><p>{descricao(i)}</p>{cov && <p>{t(`${cov[0].toLocaleString(local())} de ${cov[1].toLocaleString(local())} escolas públicas com resposta válida.`,`${cov[0].toLocaleString(local())} of ${cov[1].toLocaleString(local())} public schools with valid answers.`)}</p>}</details>
    <div className="ed-links"><Link to={c.link('/educacao/evolucao',{ind:i.id})}>{t('Evolução','Trend')}</Link><Link to={c.link('/educacao/rankings',{ind:i.id,...(row ? {ano:String(row.ano)} : {})})}>Ranking</Link><Link to={c.link('/educacao/tabela',{ind:i.id})}>{t('Tabela','Table')}</Link></div>
  </article>;
}

function GraficosResumo({ c }: { c: Ctx }) {
  const total=c.meta.indicadores.find(i=>i.id==='mat_total')!;
  const index=c.meta.indicadores.indexOf(total);
  const reference=c.ano ?? linhaEducacao(c.grupo,index,null)?.ano ?? null;
  const rows=c.grupo.linhas.filter(r=>reference===null || (r[0] as number)<=reference);
  const trend=rows.map(r=>r[index+1]);
  const sectors=[['mat_municipal',t('Municipal','Municipal')],['mat_estadual',t('Estadual','State')],['mat_federal',t('Federal','Federal')],['mat_privada',t('Privada','Private')]];
  const values=sectors.map(([id])=>linhaEducacao(c.grupo,c.meta.indicadores.findIndex(i=>i.id===id),reference)?.valor ?? null);
  return <div className="ed-graficos">
    <section className="ed-grafico"><h3>{t('Evolução das matrículas','Enrolment trends')}</h3><p className="ed-ref">{t('Educação básica · todas as redes · Censo Escolar','Basic education · all sectors · School Census')}</p>
      {trend.some(v=>v!==null) ? <Grafico nome={t('Evolução das matrículas','Enrolment trends')} altura={240} opcao={linhas(rows.map(r=>r[0] as number),[{nome:nome(total),valores:trend}],v=>fmt(total,v))} /> : <p>{t('Sem matrículas divulgadas para este período.','No published enrolments for this period.')}</p>}
    </section>
    <section className="ed-grafico"><h3>{t('Matrículas por rede de ensino','Enrolments by school sector')}</h3><p className="ed-ref">{reference ?? '—'} · {t('Localização da escola · Censo Escolar','School location · School Census')}</p>
      {values.some(v=>v!==null) ? <Grafico nome={t('Matrículas por rede de ensino','Enrolments by school sector')} altura={240} opcao={barras(sectors.map(([,label])=>label),values,v=>fmt(total,v))} /> : <p>{t('Sem matrículas divulgadas para este ano.','No published enrolments for this year.')}</p>}
    </section>
  </div>;
}

export function EducacaoPainel() {
  return <EducacaoBase pagina={t('Retrato da educação','Education at a glance')}>{c=><>
    <div className="ed-cards ed-resumo">{['mat_total','escolas','integral_pct','ideb_ai'].map(id=><Cartao c={c} i={c.meta.indicadores.find(i=>i.id===id)!} key={id} />)}</div>
    <p className="ed-nota">{t('Matrículas são registros de escolarização, não pessoas únicas. Os dados representam as escolas do território. As taxas de trajetória e o Ideb referem-se à rede pública; o ano aparece em cada cartão.','Enrolments are schooling records, not unique people. The data describe schools located in the territory. Student progression rates and Ideb refer to public schools; every card shows its reference year.')}</p>
    <nav className="ed-indice" aria-label={t('Índice de indicadores','Indicator index')}>{TEMAS.map(([id,pt,en])=><a href={'#'+id} key={id}>{t(pt,en)}</a>)}</nav>
    <GraficosResumo c={c} />
    {TEMAS.map(([id,pt,en,nota,notaEn])=><section className="ed-secao" id={id} key={id}><h3>{t(pt,en)}</h3><p>{t(nota,notaEn)}</p><div className="ed-cards">{c.meta.indicadores.filter(i=>i.tema===id).map(i=><Cartao key={i.id} c={c} i={i} />)}</div></section>)}
    <p className="ed-nota">{t('Complete a análise com os gastos por aluno e o financiamento da educação.','Complete the analysis with expenditure per student and education funding.')} <Link to={c.link('/educacao/financiamento')}>{t('Ver financiamento · SIOPE','View funding · SIOPE')}</Link></p>
    <Link to="/downloads?area=educacao">{t('Baixar os dados de educação · Stata, R, CSV e Parquet','Download education data · Stata, R, CSV and Parquet')}</Link>
  </>}</EducacaoBase>;
}

function Seletor({ c }: { c: Ctx }) {
  const id = c.sp.get('ind') ?? 'mat_total';
  return <label>{t('Indicador','Indicator')}<select aria-label={t('Indicador','Indicator')} value={c.meta.indicadores.some(i=>i.id===id) ? id : ''} onChange={e=>c.mudar({ind:e.target.value})}><option disabled value="">{t('Escolha um indicador','Choose an indicator')}</option>{c.meta.indicadores.map(i=><option key={i.id} value={i.id}>{nome(i)}</option>)}</select></label>;
}
function escolhido(c: Ctx) { return c.meta.indicadores.find(i=>i.id===(c.sp.get('ind') ?? 'mat_total')); }
function exportarSerie(c: Ctx, formato: 'csv'|'xlsx', todos = false) {
  const inds = todos ? c.meta.indicadores : [escolhido(c)].filter((x): x is IndicadorEducacao=>!!x);
  const tab: Tabela = {colunas:['cod_ibge','territorio','uf','ano',...inds.map(i=>i.variavel)],linhas:c.grupo.linhas.map(r=>[c.territorio.cod_ibge,c.territorio.nome,c.territorio.uf,r[0],...inds.map(i=>r[c.meta.indicadores.indexOf(i)+1])]),
    metadados:[[t('Fonte','Source'),'Inep · Censo Escolar, taxas de rendimento, distorção e Ideb'],[t('Referência','Reference'),c.meta.gerado_em],...inds.map((i):[string,string]=>[i.variavel,descricao(i)+' · '+(i.unidade==='percentual' ? t('percentual 0–100','percentage 0–100') : i.unidade==='indice' ? '0–10' : t('número','count'))])]};
  exportar('educacao_'+c.territorio.grupo,formato,tab,idioma()==='en' ? '.' : ',');
}

function Serie({ c, tabela = false }: { c: Ctx; tabela?: boolean }) {
  const i = escolhido(c);
  return <><div className="ed-escolha"><Seletor c={c} /></div>{!i ? <p role="alert">{t('Indicador inválido. Escolha um indicador acima.','Invalid indicator. Choose one above.')}</p> : <>
    <p className="ed-nota">{descricao(i)}</p>
    {!tabela && <Grafico nome={nome(i)} descricao={descricao(i)} opcao={linhas(c.grupo.linhas.map(r=>r[0] as number),[{nome:nome(i),valores:c.grupo.linhas.map(r=>r[c.meta.indicadores.indexOf(i)+1])}],v=>fmt(i,v))} />}
    <div className="ed-acoes"><button onClick={()=>exportarSerie(c,'csv')}>CSV</button><button onClick={()=>exportarSerie(c,'xlsx')}>Excel</button><button onClick={()=>exportarSerie(c,'csv',true)}>{t('Todos os indicadores · CSV','All indicators · CSV')}</button></div>
    <div className="ed-tabela" tabIndex={0} role="region" aria-label={t('Série histórica','Time series')}><table><caption>{nome(i)} · {c.territorio.nome}</caption><thead><tr><th>{t('Ano','Year')}</th><th>{t('Valor','Value')}</th><th>{t('Condição do dado','Data status')}</th></tr></thead><tbody>{c.grupo.linhas.map(r=><tr key={r[0]}><td>{r[0]}</td><td>{fmt(i,r[c.meta.indicadores.indexOf(i)+1])}</td><td>{r[c.meta.indicadores.indexOf(i)+1] == null ? t('Não divulgado ou indisponível','Unpublished or unavailable') : r[c.meta.indicadores.indexOf(i)+1]===0 ? t('Zero registrado','Recorded zero') : t('Registrado','Recorded')}</td></tr>)}</tbody></table></div>
  </>}</>;
}
export function EducacaoEvolucao() { return <EducacaoBase pagina={t('Evolução dos indicadores','Indicator trends')} historico>{c=><Serie c={c} />}</EducacaoBase>; }
export function EducacaoTabela() { return <EducacaoBase pagina={t('Tabela e exportações','Table and downloads')} historico>{c=><Serie c={c} tabela />}</EducacaoBase>; }

function Ranking({ c }: { c: Ctx }) {
  const i = escolhido(c); const [limite,setLimite] = useState(25); const [ordem,setOrdem] = useState('desc');
  const year = c.ano ?? (i?.anos.length ? Math.max(...i.anos) : null);
  const dados = useEducacao(year && i ? `ranking:${year}` : null,()=>obterRankingEducacao(year!));
  const rows = useMemo(()=>dados.dados && i ? dados.dados.linhas.filter(r=>(!c.territorio.uf || r[2]===c.territorio.uf) && r[c.meta.indicadores.indexOf(i)+3] != null).sort((a,b)=>{
    const av=a[c.meta.indicadores.indexOf(i)+3] as number,bv=b[c.meta.indicadores.indexOf(i)+3] as number;
    return (ordem==='asc' ? av-bv : bv-av) || Number(a[0])-Number(b[0]);
  }) : [],[dados.dados,i,c.territorio.uf,c.meta.indicadores,ordem]);
  const baixar = () => { if (!i) return; const tab: Tabela={colunas:['posicao','cod_ibge','municipio','uf','ano',i.variavel],linhas:rows.map((r,n)=>[n+1,r[0],r[1],r[2],year,r[c.meta.indicadores.indexOf(i)+3]]),metadados:[['Fonte','Inep'],['Indicador',descricao(i)]]};exportar('ranking_educacao','csv',tab,idioma()==='en'?'.':','); };
  return <><div className="ed-escolha"><Seletor c={c} /><label>{t('Ordenação','Order')}<select value={ordem} onChange={e=>{setOrdem(e.target.value);setLimite(25);}}><option value="desc">{t('Maiores valores primeiro','Highest values first')}</option><option value="asc">{t('Menores valores primeiro','Lowest values first')}</option></select></label></div>
    {!i ? <p role="alert">{t('Escolha um indicador válido.','Choose a valid indicator.')}</p> : <><p className="ed-nota">{descricao(i)} {t('A posição ordena valores; não é uma avaliação geral da qualidade da educação.','Positions sort values; they are not an overall assessment of education quality.')}</p>
      {!dados.dados ? <Carregando erro={dados.erro} tentar={dados.recarregar} /> : <><p>{year} · {rows.length.toLocaleString(local())} {t('municípios com valor divulgado','municipalities with published values')}</p><button onClick={baixar}>{t('Baixar ranking · CSV','Download ranking · CSV')}</button>
      <div className="ed-tabela" tabIndex={0}><table><thead><tr><th>#</th><th>{t('Município','Municipality')}</th><th>{t('Valor','Value')}</th></tr></thead><tbody>{rows.slice(0,limite).map((r,n)=><tr key={r[0]}><td>{n+1}</td><td><Link to={`/educacao?uf=${r[2]}&cod=${r[0]}&ano=${year}`}>{r[1]} · {r[2]}</Link></td><td>{fmt(i,r[c.meta.indicadores.indexOf(i)+3] as number)}</td></tr>)}</tbody></table></div>{rows.length>limite && <button onClick={()=>setLimite(v=>v+50)}>{t('Mostrar mais 50','Show 50 more')}</button>}
      </>}
    </>}
  </>;
}
export function EducacaoRankings() { return <EducacaoBase pagina={t('Rankings municipais de educação','Municipal education rankings')}>{c=><Ranking c={c} />}</EducacaoBase>; }
export function EducacaoMetodologia() { return <EducacaoBase pagina={t('Fontes e metodologia','Sources and methodology')} historico>{c=><>
  <p>{t('Cobertura desde 2013. As séries mantêm os anos e os vazios da fonte; não há interpolação. A referência mais recente é escolhida por indicador, salvo quando você pede um ano específico.','Coverage since 2013. Series retain source years and missing values without interpolation. The latest reference is selected per indicator unless you request a specific year.')}</p>
  <ul>{Object.values(c.meta.fontes).map(f=><li key={f.url}><a href={f.url} target="_blank" rel="noreferrer">Inep · {f.nome}</a></li>)}</ul>
  <p>{t('As contagens de escolas e matrículas são somadas por território. Percentuais de infraestrutura dividem a soma de escolas com o item pela soma das escolas com resposta válida. Taxas de rendimento, distorção e Ideb de Brasil e UF são os resultados oficiais desses recortes, sem tirar a média dos municípios.','School and enrolment counts are summed by territory. Infrastructure percentages divide schools reporting an item by schools with valid answers. Brazil and state progression rates, age-grade distortion and Ideb use official results for those areas, without averaging municipalities.')}</p>
  <p>{t('O município é o local da escola, não necessariamente a residência do aluno. Brasília é representada pelo código 5300108; Fernando de Noronha é um distrito estadual. Ausência de escolas em uma rede não é ausência de resposta sobre infraestrutura.','Municipality refers to the school location, which may differ from the student’s residence. Brasília uses code 5300108; Fernando de Noronha is a state district. The absence of schools in a sector is different from a missing infrastructure response.')}</p>
  <p>{t('O Ideb combina fluxo escolar e desempenho no Saeb. Sua publicação é bienal e depende dos critérios de divulgação do Inep. Valores ausentes continuam vazios, inclusive nos rankings e nas exportações.','Ideb combines student progression and Saeb achievement. It is published every two years under Inep publication criteria. Missing values remain missing in rankings and downloads.')}</p>
  <div className="ed-tabela" tabIndex={0}><table><caption>{t('Dicionário dos indicadores','Indicator dictionary')}</caption><thead><tr><th>{t('Variável','Variable')}</th><th>{t('Descrição','Description')}</th><th>{t('Anos observados neste recorte','Observed years in this area')}</th></tr></thead><tbody>{c.meta.indicadores.map((i,index)=><tr key={i.id}><td><code>{i.variavel}</code></td><td>{descricao(i)}</td><td>{c.grupo.linhas.filter(r=>r[index+1]!==null).map(r=>r[0]).join(', ') || '—'}</td></tr>)}</tbody></table></div>
  <Link to="/downloads?area=educacao">{t('Dados, dicionário e API para R/Stata','Data, dictionary and API for R/Stata')}</Link>
  </>}</EducacaoBase>; }
