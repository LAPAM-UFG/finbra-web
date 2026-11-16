import { local, t } from './idioma';
import type { IndicadorMapa, LinhaMapaDados } from './mapas_dados';
export const CORES_MAPA = ['#edf5fc', '#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'];
export const COR_AUSENTE_MAPA = '#a7adb5';
export const valorEfetivoMapa = (l: LinhaMapaDados, ressalvas: boolean) => !ressalvas && l.condicao === 8 ? null : l.valor;
export function corMapa(v: number | null, escala: number[]): string {
  if (v === null || !Number.isFinite(v)) return COR_AUSENTE_MAPA;
  if (v === 0) return CORES_MAPA[0];
  const k = escala.findIndex(x => v < x); return CORES_MAPA[k < 0 ? 5 : k + 1];
}
export function formatarMapa(i: IndicadorMapa, v: number | null, limite = false): string {
  if (v === null) return t('sem valor', 'no value');
  const n = i.formato === 'fracao' ? v * 100 : v;
  const percentual = i.formato === 'percentual' || i.formato === 'fracao';
  if (i.formato === 'moeda') return new Intl.NumberFormat(local(), { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 }).format(n);
  const casas = limite ? 8 : i.formato === 'numero' && Number.isInteger(n) ? 0 : percentual ? 2 : 3;
  if (!limite && n > 0 && n < 10 ** -casas) return `<${(10 ** -casas).toLocaleString(local(), { maximumFractionDigits: casas })}${percentual ? '%' : ''}`;
  if (!limite && percentual && n < 100 && n > 99.99) return `>${(99.99).toLocaleString(local())}%`;
  return n.toLocaleString(local(), { maximumFractionDigits: casas }) + (percentual ? '%' : '');
}
export function legendaMapa(i: IndicadorMapa): string[] {
  const e = i.escala.map(x => formatarMapa(i, x, true));
  return [t('Zero registrado', 'Reported zero'), t(`Mais de 0 a menos de ${e[0]}`, `Over 0 to under ${e[0]}`), ...e.slice(0, -1).map((v, k) => t(`${v} a menos de ${e[k + 1]}`, `${v} to under ${e[k + 1]}`)), t(`${e[3]} ou mais`, `${e[3]} or more`), t('Sem valor exibido', 'No displayed value')];
}
export function marcadorInepMapa(code: number | null): string {
  return [t('Publicado sem marcador', 'Published without a flag'), t('Média de avaliação estadual usada pelo Inep após extravio de provas do Saeb.', 'State assessment used by Inep following lost Saeb tests.'), t('Participação inferior a 50% após extravio de provas; resultado com ressalva do Inep.', 'Participation below 50% following lost tests; result flagged by Inep.'), t('Não divulgado por solicitação.', 'Withheld on request.'), t('Participantes insuficientes para divulgação.', 'Insufficient participants for publication.'), t('Sem resultado divulgado.', 'No published result.'), t('Pelo menos 20% das provas extraviadas e participação insuficiente para divulgação.', 'At least 20% of tests lost and insufficient participation for publication.')][code ?? -1] ?? '';
}
export function condicaoMapa(l: LinhaMapaDados): string {
  if (l.marcador !== null && l.marcador > 0) return marcadorInepMapa(l.marcador);
  return [t('registrado', 'recorded'), t('zero registrado', 'reported zero'), t('sem registro', 'no record'), t('denominador ausente', 'missing denominator'), t('denominador zero: razão indefinida', 'zero denominator: undefined ratio'), t('fora da cobertura', 'outside coverage'), t('preliminar', 'preliminary'), t('ano sem edição da avaliação', 'year without an assessment edition'), t('resultado com ressalva do Inep', 'result flagged by Inep')][l.condicao] ?? t('indisponível', 'unavailable');
}
export function buscarMunicipiosMapa(linhas: LinhaMapaDados[], busca: string): LinhaMapaDados[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
  const palavras = norm(busca.trim()).split(/\s+/).filter(Boolean);
  return palavras.length ? linhas.filter(l => palavras.every(p => norm(`${l.nome} ${l.uf} ${l.cod}`).includes(p))) : linhas;
}
