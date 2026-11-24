import { formatoComparacao, textoComparacao } from './comparacoes_apresentacao';
import type { GeografiaComparacao } from './comparacoes_dados';
import { t } from './idioma';
import { apresentacaoRaio, chaveRaio, formatarRaio, indicadoresRaio, leitorRaio, obterSerieRaio, pontoEfetivoRaio, type CatalogoRaio, type IndicadorRaio, type MetaRaio, type PontoRaio, type RetratoRaio, type SerieRaio } from './raio_x';

// Totais já presentes no resumo são preservados. As novas taxas e medidas
// monetárias usam a unidade comparável publicada, sem somar índices municipais.
export const DESTAQUES_RAIO = [
  ['referencias:rx_populacao', false], ['referencias:rx_pib_hab', false],
  ['trabalho_todas:empregos', false], ['trabalho_todas:rem_media_real', false],
  ['saude_todas:mortalidade_infantil', false], ['educacao_todas:mat_total', false],
  ['saneamento_todas:agua_cobertura_pct', false], ['assistencia_todas:cad_qtd_familias', false],
  ['saude_todas:leitos_mil', true], ['saude_todas:aps_potencial', true],
  ['saude_todas:icsap_taxa', true], ['educacao_todas:ideb_ai', true],
  ['educacao_todas:apr_ai', true], ['saneamento_todas:esgoto_cobertura_pct', true],
  ['saneamento_todas:residuos_coleta_pct', true], ['assistencia_todas:pbf_familias_atendidas', false],
  ['assistencia_todas:bpc_beneficios', false], ['trabalho_todas:mulheres', true],
  ['financas_todas:fin_receita_liquida', true], ['financas_todas:fin_investimentos', true],
  ['gestao_todas:m_tr_lai', false], ['clima_todas:temperatura_c', true],
  ['agropecuaria_todas:valor_lavouras_ha', true], ['mobilidade_todas:veiculos_mil', true],
  ['seguranca_todas:agressoes_100mil', true], ['internet_todas:acessos_100hab', true],
  ['energia_todas:gd_kw_hab', true], ['comex_todas:exp_hab', true],
] as const;

export function destaquesRaio(c: CatalogoRaio, grupo: string, rede: string) {
  const disponiveis = new Map(indicadoresRaio(c, grupo, rede).map(x => [chaveRaio(x.i), x]));
  return DESTAQUES_RAIO.flatMap(([key, comparavel]) => {
    const item = disponiveis.get(key.replace('educacao_todas:', `educacao_${rede}:`));
    return item ? [{ ...item, comparavel }] : [];
  });
}
export type DestaqueRaio = ReturnType<typeof destaquesRaio>[number];

export function gruposReferenciaDestaques(g: GeografiaComparacao, grupo: string): string[] {
  if (grupo === 'BR') return [];
  const ter = g.territorios[grupo];
  return ter?.nivel === 'M' && ter.uf && ter.uf !== 'DF' ? [ter.uf, 'BR'] : ['BR'];
}

/** Mês e ano exatos: nunca substitui por outra observação, nem do mesmo ano. */
export function pontoExatoDestaque(s: SerieRaio, periodo: number): PontoRaio | null {
  const k = s.periodos.indexOf(periodo);
  if (k < 0) return null;
  const linha = (x: SerieRaio['serie']): [number|null, number|null, number|null, number, number, number|null] =>
    [x.v[k] ?? null, x.n[k] ?? null, x.d[k] ?? null, x.c[k], x.q[k], x.r?.[k] ?? null];
  const base = linha(s.serie), ponto: PontoRaio = [periodo, ...base];
  if (s.serie.com_ressalvas) {
    const alt = linha(s.serie.com_ressalvas);
    if (JSON.stringify(alt) !== JSON.stringify(base)) ponto[7] = alt;
  }
  return ponto;
}

type Dependencias = { retrato: typeof leitorRaio.retrato; serie: typeof obterSerieRaio };
/** Razão das somas em três anos completos; nunca média das taxas anuais. */
export function trienioDestaque(s:SerieRaio,fim:number,ressalvas=false):PontoRaio|null {
  const pp=[fim-2,fim-1,fim].map(y=>pontoEfetivoRaio(pontoExatoDestaque(s,y),ressalvas));
  if(pp.some(p=>!p||p[2]===null||p[3]===null||p[3]!<0||![0,1,6,16].includes(p[4])))return null;
  const ns=pp as PontoRaio[],n=ns.reduce((v,p)=>v+p[2]!,0),d=ns.reduce((v,p)=>v+p[3]!,0);
  if(d<=0)return null;
  return [fim,n/d*1000,n,d,ns.some(p=>p[4]===16)?16:ns.some(p=>p[4]===6)?6:n===0?1:0,Math.min(...ns.map(p=>p[5])),null];
}
export async function referenciasDestaques(
  m: MetaRaio, c: CatalogoRaio, g: GeografiaComparacao, r: RetratoRaio, itens: DestaqueRaio[],
  dep: Dependencias = { retrato: leitorRaio.retrato, serie: obterSerieRaio },
) {
  const grupos = gruposReferenciaDestaques(g, r.grupo);
  const pontos: Record<string, Record<string, PontoRaio|null>> = {};
  const falhas: string[] = [];
  const locais:Record<string,PontoRaio>={},trienios:Record<string,number>={},trieniosSemBase:Record<string,number>={};
  await Promise.all(itens.filter(({i,k})=>i.id==='mortalidade_infantil'&&r.linhas[k]?.[3]!==null&&(r.linhas[k]?.[3]??Infinity)<(i.minimo??1000)).map(async({i,k})=>{
    const p=r.linhas[k];if(!p)return;
    try {const tri=trienioDestaque(await dep.serie(c,g,r.grupo,i),p[0]);if(tri){locais[chaveRaio(i)]=tri;trienios[chaveRaio(i)]=p[0];}else trieniosSemBase[chaveRaio(i)]=p[0];}catch{falhas.push('trienio:'+r.grupo);}
  }));
  await Promise.all(grupos.map(async grupo => {
    pontos[grupo] = {};
    let retrato: RetratoRaio;
    try { retrato = await dep.retrato(m, g, grupo); }
    catch { falhas.push(grupo); return; }
    await Promise.all(itens.map(async ({ i, k }) => {
      const p = r.linhas[k];
      const key = chaveRaio(i);
      // Observações fora da cobertura não disparam leituras de séries inteiras.
      if (!p || !i.periodos.includes(p[0])) { pontos[grupo][key] = null; return; }
      if(trienios[key]){try{pontos[grupo][key]=trienioDestaque(await dep.serie(c,g,grupo,i),trienios[key]);}catch{pontos[grupo][key]=null;falhas.push(grupo+':'+key);}return;}
      const pronto = retrato.linhas[k];
      if (!pronto || pronto[0] === p[0]) { pontos[grupo][key] = pronto; return; }
      try { pontos[grupo][key] = pontoExatoDestaque(await dep.serie(c, g, grupo, i), p[0]); }
      catch { pontos[grupo][key] = null; falhas.push(`${grupo}:${key}`); }
    }));
  }));
  return { pontos, falhas, locais, trienios, trieniosSemBase };
}

export function apresentacaoDestaque(item: DestaqueRaio, p: PontoRaio|null, grupo: string, ressalvas: boolean, g?:GeografiaComparacao,esperado?:number|null) {
  const a = apresentacaoRaio(item.i, p, grupo, ressalvas,g,esperado);
  return item.comparavel ? { ...a, nome: textoComparacao(item.i, 'nome'), unidade: textoComparacao(item.i, 'unidade'), valor: a.comparavel, texto: formatarRaio(item.i, a.comparavel) } : a;
}

export function referenciaDestaque(i: IndicadorRaio, local: PontoRaio|null, regional: PontoRaio|null, ressalvas: boolean) {
  const p = pontoEfetivoRaio(regional, ressalvas), l = pontoEfetivoRaio(local, ressalvas);
  // A comparação deve se referir à mesma data mesmo quando há falhas de rede.
  if (!p || !l || p[0] !== l[0]) return { valor: null, texto: '—', condicao: '' };
  const populacao = i.catalogo === 'referencias' && i.id === 'rx_populacao';
  const valor = populacao ? l[1] !== null && p[1] !== null && p[1] > 0 ? l[1] / p[1] * 100 : null : p[1];
  const texto = populacao ? formatoComparacao({ ...i, formato: 'percentual', unidade: '%' }, valor) : formatarRaio(i, valor);
  const condicao = p[4] === 16 ? t('cobertura incompleta', 'incomplete coverage') : p[4] === 11 ? t('parcial', 'partial') : p[4] === 6 ? t('preliminar', 'preliminary') : '';
  return { valor, texto, condicao };
}
