import { numeroAgro as fmt } from '../agropecuaria_apresentacao';
import { t } from '../idioma';
/** Gráfico leve de uma série; mantém lacunas e não precisa baixar biblioteca gráfica. */
export function SerieAgro({anos,vs,nome}:{anos:number[];vs:(number|null)[];nome:string}){
 const validos=vs.filter((v):v is number=>v!==null);if(!validos.length)return <p className="ag-nota">{t('Não há valores disponíveis para este indicador e lugar na série. Consulte a condição de cada ano abaixo.','No values are available for this indicator and place in this series. See the data status for each year below.')}</p>;
 const max=Math.max(...validos,1),min=Math.min(...validos,0),y=(v:number)=>175-(v-min)/(max-min)*145,x=(j:number)=>65+j*590/Math.max(1,anos.length-1);
 const segmentos:string[]=[];let atual:string[]=[];vs.forEach((v,j)=>{if(v===null){if(atual.length)segmentos.push(atual.join(' '));atual=[];}else atual.push(`${x(j)},${y(v)}`);});if(atual.length)segmentos.push(atual.join(' '));
 return <svg className="ag-serie" viewBox="0 0 700 212" role="img" aria-label={nome}><title>{nome}</title>{[0,.5,1].map(a=><g key={a}><line x1="65" x2="655" y1={175-a*145} y2={175-a*145} className="ag-grade"/><text x="57" y={179-a*145} textAnchor="end">{fmt(min+(max-min)*a,true)}</text></g>)}{segmentos.map((s,k)=><polyline key={k} points={s} fill="none" className="ag-linha"/>)}{vs.map((v,j)=>v===null?null:<circle key={j} cx={x(j)} cy={y(v)} r="3.5" className="ag-ponto"><title>{anos[j]}: {fmt(v)}</title></circle>)}{anos.filter((_,j)=>j===0||j===anos.length-1||j%3===0).map(a=><text x={x(anos.indexOf(a))} y="202" textAnchor="middle" key={a}>{a}</text>)}</svg>;
}

