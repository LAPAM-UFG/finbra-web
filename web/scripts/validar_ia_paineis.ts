/** Validação dos leitores reais da IA, sem chamar um modelo: executar contra o servidor da candidata. */
import assert from 'node:assert/strict';
import {writeFileSync}from'node:fs';
import {executarPainelPreparado,TEMAS_PREPARADOS}from'../src/ia_paineis';
const output=process.argv[2];
const results:unknown[]=[];
for(const tema of TEMAS_PREPARADOS){
 const t0=performance.now();const c=await executarPainelPreparado({tema,operacao:'catalogo'},[tema],undefined,20000);assert.ok(!('erro'in c),JSON.stringify(c));if('erro'in c)continue;
 const all=c.linhas.map(l=>Object.fromEntries(c.colunas.map((k,j)=>[k,l[j]])));
 const ids=[all.find(x=>!x.comparavel)!.indicador,all.find(x=>x.comparavel)!.indicador]as string[];
 const s=await executarPainelPreparado({tema,operacao:'serie',indicadores:ids,territorios:['5208905','GO','BR'],anos:[2012,2024,2026]},[tema]);assert.ok(!('erro'in s),JSON.stringify(s));if('erro'in s)continue;
 assert.equal(s.total,18);const rows=s.linhas.map(l=>Object.fromEntries(s.colunas.map((k,j)=>[k,l[j]])));
 assert.ok(rows.every(r=>r.fonte&&r.edicao&&r.unidade));assert.ok(rows.filter(r=>r.ano===2012).every(r=>r.valor===null));
 const q=await executarPainelPreparado({tema,operacao:'ranking',indicadores:[ids[1]],uf:'GO',limite:5},[tema]);assert.ok(!('erro'in q),JSON.stringify(q));
 const regions=await executarPainelPreparado({tema,operacao:'territorios',nivel:'imediata',uf:'GO',limite:1},[tema]);assert.ok(!('erro'in regions));
 if(!('erro'in regions)&&regions.linhas.length){const reg=String(regions.linhas[0][0]);const rr=await executarPainelPreparado({tema,operacao:'serie',indicadores:[ids[1]],territorios:[reg]},[tema]);assert.ok(!('erro'in rr),JSON.stringify(rr));}
 results.push({tema,indicadores:c.total,ms:Math.round(performance.now()-t0),pedidos:ids,amostra:rows,ranking:q});console.log(tema,'conferido');
}
assert.equal(results.length,6);writeFileSync(output,JSON.stringify({ok:true,temas:results},null,2));
