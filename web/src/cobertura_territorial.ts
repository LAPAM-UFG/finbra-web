import vigencia from '../../shared/vigencia_municipios.json';
import type { GeografiaComparacao } from './comparacoes_dados';

export function quantidadeEsperada(g:GeografiaComparacao,grupo:string,periodo:number) {
  if(/^\d{7}$/.test(grupo))return 1;
  const ano=periodo>10000?Math.floor(periodo/100):periodo;
  const inicios:Record<string,number>=vigencia.inicio;
  return g.municipios.filter(m=>(grupo==='BR'||m[2]===grupo||'I:'+m[3]===grupo||'T:'+m[4]===grupo)&&(inicios[String(m[0])]??1900)<=ano).length;
}
