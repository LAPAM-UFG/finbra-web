import { useId, useMemo, useState } from 'react';
import type { GeografiaComparacao } from '../comparacoes_dados';
import { normComparacao } from '../comparacoes_apresentacao';
import { nomeTerritorioRaio } from '../raio_x';
import { t } from '../idioma';

export function BuscaRaioX({g,grupo,escolher}:{g:GeografiaComparacao;grupo:string;escolher:(grupo:string)=>void}) {
  const id=useId();const [texto,setTexto]=useState<string|null>(null),[aberta,setAberta]=useState(false),[ativo,setAtivo]=useState(0);
  const lugares=useMemo(()=>[
    {grupo:'BR',nome:t('Brasil','Brazil'),tipo:t('País','Country')},
    ...g.governos.map(([cod,nome,uf])=>({grupo:uf,nome:`${nome} (${uf})`,tipo:uf==='DF'?t('Distrito Federal','Federal District'):t('Estado','State')})),
    ...g.municipios.map(([cod,nome,uf])=>({grupo:String(cod),nome:`${nome} (${uf})`,tipo:cod===2605459?t('Distrito estadual','State district'):cod===5300108?t('Distrito Federal','Federal District'):t('Município','Municipality')})),
  ],[g]);
  const opcoes=useMemo(()=>{if(texto===null)return lugares.filter(x=>x.grupo===grupo);const q=normComparacao(texto.trim());const prioridade=(x:typeof lugares[number])=>x.grupo.toLowerCase()===q?3:normComparacao(x.nome.split(' (')[0])===q?2:Number(normComparacao(x.nome).startsWith(q));return lugares.filter(x=>!q?x.grupo.length<3:normComparacao(x.nome).includes(q)||x.grupo.toLowerCase().startsWith(q)).sort((a,b)=>prioridade(b)-prioridade(a)||a.nome.localeCompare(b.nome,'pt-BR')).slice(0,14);},[lugares,texto,grupo]);
  const selecionar=(valor:string)=>{escolher(valor);setTexto(null);setAberta(false);setAtivo(0);};
  return <div className="rx-busca">
    <label htmlFor={id}>{t('Qual lugar você quer conhecer?','Which place would you like to explore?')}</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={aberta} aria-controls={`${id}-lista`} aria-activedescendant={aberta&&opcoes[ativo]?`${id}-${ativo}`:undefined}
      value={texto??nomeTerritorioRaio(g,grupo)} placeholder={t('Digite município, estado ou código IBGE','Type a municipality, state or IBGE code')}
      onFocus={e=>{e.currentTarget.select();setAberta(true);}} onChange={e=>{setTexto(e.target.value);setAberta(true);setAtivo(0);}} onBlur={()=>setAberta(false)}
      onKeyDown={e=>{if(e.key==='Escape'){setAberta(false);setTexto(null);}if(e.key==='ArrowDown'){e.preventDefault();setAberta(true);setAtivo(v=>Math.min(v+1,opcoes.length-1));}if(e.key==='ArrowUp'){e.preventDefault();setAtivo(v=>Math.max(0,v-1));}if(e.key==='Enter'&&aberta&&opcoes[ativo]){e.preventDefault();selecionar(opcoes[ativo].grupo);}}}/>
    <p className="rx-ajuda">{t('Busque em todo o Brasil. Não precisa escolher um estado antes.','Search across Brazil. No prior state selection is required.')}</p>
    {aberta&&<div id={`${id}-lista`} role="listbox" className="rx-opcoes" aria-label={t('Lugares encontrados','Place results')}>
      {opcoes.length?opcoes.map((o,k)=><button type="button" role="option" id={`${id}-${k}`} aria-selected={ativo===k} key={o.grupo} onMouseDown={e=>e.preventDefault()} onClick={()=>selecionar(o.grupo)}><span>{o.nome}</span><small>{o.tipo} · {o.grupo}</small></button>):<p>{t('Nenhum lugar encontrado. Confira o nome ou o código.','No places found. Check the name or code.')}</p>}
    </div>}
  </div>;
}
