import { useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t, local } from '../idioma';
import { UF_NOMES } from '../ufs';

export type LugarOpcao = { grupo: string; nome: string; tipo: 'BR'|'UF'|'M'|'D'; uf?: string };
export function lugaresCadastro(municipios:{cod:string|number;nome:string;uf:string}[],ufs=Object.keys(UF_NOMES)):LugarOpcao[] {
  return [{grupo:'BR',nome:'Brasil',tipo:'BR'},...ufs.map(uf=>({grupo:uf,nome:UF_NOMES[uf]?.[0]??uf,uf,tipo:uf==='DF'?'D' as const:'UF' as const})),...municipios.filter(x=>String(x.cod)!=='5300108').map(x=>({grupo:String(x.cod),nome:x.nome,uf:x.uf,tipo:String(x.cod)==='2605459'?'D' as const:'M' as const}))];
}

export function usePeriodoUrl(anos:number[],ano:number|string|null,parametro='ano') {
  const [sp,setSp]=useSearchParams(),pedido=sp.get(parametro);
  const assinatura=anos.join(',');
  useEffect(()=>{
    if(!pedido||!/^\d{4}$/.test(pedido)||!anos.length||anos.includes(Number(pedido)))return;
    const n=new URLSearchParams(sp);n.set('ano_pedido',pedido);
    if(ano===null||ano==='')n.delete(parametro);else n.set(parametro,String(ano));
    setSp(n,{replace:true});
  },[pedido,assinatura,ano,parametro]); // eslint-disable-line react-hooks/exhaustive-deps
}
const norm = (s:string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export const nomeLugar = (x:LugarOpcao) => x.tipo==='BR'?t('Brasil','Brazil'):x.tipo==='UF'?`${x.nome} (${t('estado','state')})`:x.tipo==='D'?`${x.nome} (${t('distrito','district')})`:`${x.nome}${x.uf?` (${x.uf})`:''}`;

/** Busca única, sem chamadas de rede: cada fonte fornece seu próprio cadastro válido. */
export function SeletorLugar({ lugares, valor, escolher, rotulo, ajuda=true, aoAbrir, carregando=false }: {lugares:LugarOpcao[];valor:string;escolher:(grupo:string)=>void;rotulo?:string;ajuda?:boolean;aoAbrir?:()=>void;carregando?:boolean}) {
  const id=useId(),[texto,setTexto]=useState<string|null>(null),[aberta,setAberta]=useState(false),[ativo,setAtivo]=useState(0);
  const selecionado=lugares.find(x=>x.grupo===valor);
  const opcoes=useMemo(()=>{
    const q=norm(texto??'');
    const prioridade=(x:LugarOpcao)=>norm(x.grupo)===q?4:norm(x.nome)===q?3:norm(x.nome).startsWith(q)?2:1;
    return lugares.filter(x=>!q?x.tipo!=='M':norm(nomeLugar(x)).includes(q)||norm(x.grupo).startsWith(q))
      .sort((a,b)=>prioridade(b)-prioridade(a)||a.nome.localeCompare(b.nome,local())).slice(0,30);
  },[lugares,texto]);
  const selecionar=(v:string)=>{escolher(v);setTexto(null);setAberta(false);setAtivo(0);};
  return <div className="seletor-lugar rx-busca">
    <label htmlFor={id}>{rotulo??t('Lugar — município, estado ou Brasil','Place — municipality, state or Brazil')}</label>
    <input id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={aberta} aria-controls={`${id}-lista`} aria-activedescendant={aberta&&opcoes[ativo]?`${id}-${ativo}`:undefined}
      value={texto??(selecionado?nomeLugar(selecionado):valor)} placeholder={t('Busque pelo nome ou código IBGE','Search by name or IBGE code')}
      onFocus={e=>{e.currentTarget.select();setAberta(true);aoAbrir?.();}} onChange={e=>{setTexto(e.target.value);setAberta(true);setAtivo(0);}} onBlur={()=>{setAberta(false);setTexto(null);}}
      onKeyDown={e=>{if(e.key==='Escape'){setAberta(false);setTexto(null);}if(e.key==='ArrowDown'){e.preventDefault();setAberta(true);setAtivo(v=>Math.min(v+1,Math.max(0,opcoes.length-1)));}if(e.key==='ArrowUp'){e.preventDefault();setAtivo(v=>Math.max(0,v-1));}if(e.key==='Enter'&&aberta&&opcoes[ativo]){e.preventDefault();selecionar(opcoes[ativo].grupo);}}}/>
    {ajuda&&<small className="rx-ajuda">{t('Busque em todo o Brasil. Não precisa escolher um estado antes.','Search across Brazil. No prior state selection is required.')}</small>}
    {aberta&&<div id={`${id}-lista`} role="listbox" className="rx-opcoes" aria-label={t('Lugares encontrados','Place results')}>
      {carregando&&<p role="status">{t('Carregando os lugares…','Loading places…')}</p>}
      {opcoes.length?opcoes.map((o,k)=><button type="button" role="option" id={`${id}-${k}`} aria-selected={ativo===k} key={o.grupo} onMouseDown={e=>e.preventDefault()} onClick={()=>selecionar(o.grupo)}><span>{nomeLugar(o)}</span><small>{o.tipo==='M'?t('Município','Municipality'):o.tipo==='UF'?t('Estado','State'):o.tipo==='D'?t('Distrito','District'):t('País','Country')} · {o.grupo}</small></button>):!carregando&&<p>{t('Nenhum lugar encontrado. Confira o nome ou o código.','No places found. Check the name or code.')}</p>}
    </div>}
  </div>;
}

/** Períodos vêm da fonte; opções sem dados não são oferecidas. */
export function SeletorPeriodo({valor,opcoes,mudar,rotulo,parametro='ano'}: {valor:string|number;opcoes:{valor:string|number;nome:string}[];mudar:(v:string)=>void;rotulo?:string;parametro?:string|false}) {
  const id=useId();
  usePeriodoUrl(parametro===false?[]:opcoes.filter(x=>/^\d{4}$/.test(String(x.valor))).map(x=>Number(x.valor)),valor,parametro||'ano');
  return <div className="campo seletor-periodo"><label htmlFor={id}>{rotulo??t('Período','Period')}</label><select id={id} value={valor} onChange={e=>mudar(e.target.value)}>{opcoes.map(x=><option key={x.valor} value={x.valor}>{x.nome}</option>)}</select></div>;
}
