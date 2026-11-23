import rotulos from '../../shared/rotulos_publicos.json';
import { idioma, t } from './idioma';

export function unidadePublica(texto:string) {
  let s=texto.trim();
  if(/^(?:hectares|toneladas|quilogramas|metros|cabeças|milheiros|mil|frutos|litros|dúzias)\b/i.test(s))s=s.toLowerCase();
  if(idioma()!=='en')return s;
  const unidades:Record<string,string>=rotulos.unidades;
  return unidades[s]??s.replace(/R\$ de dez\/(\d+)/g,'Dec/$1 R$').replace(/por habitante/g,'per resident').replace(/por aluno/g,'per pupil');
}
type Def={id?:string;nome?:string;nome_en?:string;descricao?:string;descricao_en?:string;unidade?:string;unidade_en?:string;numerador_id?:string;denominador_id?:string;numerador_nome?:string;denominador_nome?:string;numerador_nome_en?:string;denominador_nome_en?:string};
/** Apenas apresentação. Códigos, posições e valores do catálogo permanecem intactos. */
export function apresentarCatalogo<T extends {indicadores:Def[];derivados?:Def[];produtos?:Def[]}>(c:T):T {
  const porId=new Map([...c.indicadores,...(c.derivados??[])].map(v=>[v.id,v]));
  const componente=(v:Def,k:'numerador'|'denominador')=>{const original=v[k+'_nome' as keyof Def],en=v[k+'_nome_en' as keyof Def],fonte=porId.get(v[k+'_id' as keyof Def]);return idioma()!=='en'?original:en??(fonte?.nome_en?fonte.nome_en+(fonte.unidade?' ('+unidadePublica(fonte.unidade_en??fonte.unidade)+')':''):original);};
  const item=(v:Def)=>({...v,...(v.unidade?{unidade:unidadePublica(idioma()==='en'?v.unidade_en??v.unidade:v.unidade)}:{}),...(v.descricao?{descricao:t(v.descricao,v.descricao_en??v.descricao)}:{}),...(v.numerador_nome?{numerador_nome:componente(v,'numerador')}:{}),...(v.denominador_nome?{denominador_nome:componente(v,'denominador')}:{})});
  return {...c,indicadores:c.indicadores.map(item),...(c.derivados?{derivados:c.derivados.map(item)}:{}),...(c.produtos?{produtos:c.produtos.map(p=>({...p,nome:t(p.nome??'',p.nome_en??p.nome??'')}))}:{})} as T;
}
