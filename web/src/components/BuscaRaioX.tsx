import { useMemo } from 'react';
import type { GeografiaComparacao } from '../comparacoes_dados';
import { SeletorLugar, type LugarOpcao } from './SeletorLugar';

export function BuscaRaioX({g,grupo,escolher}:{g:GeografiaComparacao;grupo:string;escolher:(grupo:string)=>void}) {
  const lugares=useMemo<LugarOpcao[]>(()=>[
    {grupo:'BR',nome:'Brasil',tipo:'BR'},
    ...g.governos.map(([,nome,uf])=>({grupo:uf,nome,tipo:uf==='DF'?'D' as const:'UF' as const,uf})),
    ...g.municipios.filter(([cod])=>cod!==5300108).map(([cod,nome,uf])=>({grupo:String(cod),nome,uf,tipo:cod===2605459?'D' as const:'M' as const})),
  ],[g]);
  return <SeletorLugar lugares={lugares} valor={grupo==='5300108'&&g.territorios.DF?'DF':grupo} escolher={escolher}/>;
}
