import {t} from './idioma';
/** Contexto visível do gráfico, capturado no clique, inclusive quando o recorte mudou. */
export type MetadadosImagem={titulo:string;contexto:string;fonte:string;escala?:{cores:string[];rotulos:string[]};legenda?:{cor:string;texto:string}[]};
const limpar=(s:string|undefined|null)=>(s??'').replace(/\s+/g,' ').trim();
function textoSemBotoes(el:Element|null|undefined){const copia=el?.cloneNode(true) as Element|undefined;copia?.querySelectorAll('button,svg').forEach(e=>e.remove());return limpar(copia?.textContent);}
export function fonteDaPagina(caminho:string){
 if(caminho.startsWith('/saneamento'))return t('Ministério das Cidades · SNIS / SINISA','Ministry of Cities · SNIS / SINISA');
 if(caminho.startsWith('/trabalho'))return t('Ministério do Trabalho e Emprego · RAIS / Novo CAGED','Ministry of Labour and Employment · RAIS / New CAGED');
 if(caminho.startsWith('/munic'))return 'IBGE · MUNIC / ESTADIC';
 if(caminho.startsWith('/clima'))return t('CHIRPS / ERA5-Land · estimativas de grade','CHIRPS / ERA5-Land · gridded estimates');
 if(caminho.startsWith('/assistencia'))return t('MDS / CGU · CadÚnico, Bolsa Família e BPC','MDS / CGU · Cadastro Único, Bolsa Família and BPC');
 if(caminho.startsWith('/datasus/vacinacao'))return t('Ministério da Saúde · PNI · cobertura vacinal oficial','Ministry of Health · PNI · official vaccination coverage');
 if(caminho.startsWith('/datasus/financiamento'))return t('Ministério da Saúde · Fundo Nacional de Saúde','Ministry of Health · National Health Fund');
 if(caminho.startsWith('/datasus'))return t('Ministério da Saúde / DATASUS · fontes e definições na página','Ministry of Health / DATASUS · sources and definitions on the page');
 if(caminho==='/saude')return t('Ministério da Saúde · SIOPS','Ministry of Health · SIOPS');
 if(caminho.startsWith('/educacao/financiamento')||caminho.startsWith('/educacao/profissionais'))return 'FNDE · SIOPE';
 if(caminho.startsWith('/educacao'))return t('Inep · Censo Escolar, taxas, Ideb e Saeb','Inep · School Census, rates, Ideb and Saeb');
 if(caminho==='/socioeconomico')return t('IBGE / SICONFI / CGU / Previdência · fontes e definições na página','IBGE / SICONFI / CGU / Social Security · sources and definitions on the page');
 if(caminho==='/deflatores')return 'IBGE / Banco Central · IPCA';
 return t('Tesouro Nacional · SICONFI · valores declarados pelos entes','National Treasury · SICONFI · values reported by governments');
}
export function metadadosDoGrafico(el:HTMLElement,descricao?:string):MetadadosImagem {
 const main=el.closest('main'),secao=el.closest('section,article,.cartao')??el.parentElement;
 const titulo=limpar(secao?.querySelector('h3,h4')?.textContent)||limpar(descricao)||limpar(main?.querySelector('h2')?.textContent)||'LAPAM · gráfico';
 const subtitulo=textoSemBotoes(main?.querySelector('.subtitulo'));
 const contexto=[subtitulo?`${t('Recorte na página','Page scope')}: ${subtitulo}`:'',secao?.querySelector('p.desc')?.textContent];
 // A opção selecionada é o recorte efetivo; texto digitado numa busca não é uma seleção.
 for(const select of main?.querySelectorAll<HTMLSelectElement>('select')??[]) {
  if(select.closest('nav'))continue;
  const label=select.id?Array.from(main?.querySelectorAll('label')??[]).find(l=>l.htmlFor===select.id)?.textContent:select.getAttribute('aria-label');
  const escolha=select.selectedOptions[0]?.textContent;
  if(label&&escolha)contexto.push(`${limpar(label)}: ${limpar(escolha)}`);
 }
 const fonte=[...Array.from(secao?.querySelectorAll('p')??[]),...Array.from(main?.querySelectorAll('p.nota-base')??[])].map(p=>limpar(p.textContent)).find(s=>/^Fonte:|^Source:/i.test(s))??fonteDaPagina(location.pathname);
 const gradiente=(secao?.querySelector<HTMLElement>('.cl-escala')?.style.backgroundImage??'').match(/#[a-f0-9]{3,8}|rgba?\([^)]+\)/gi)??[];
 const rotulos=Array.from(secao?.querySelectorAll('.cl-escala-rotulos span')??[]).map(e=>limpar(e.textContent));
 const legenda=Array.from(secao?.querySelectorAll('.cl-legenda li')??[]).map(e=>({cor:e.querySelector<HTMLElement>('i')?.style.backgroundColor??'',texto:limpar(e.textContent)})).filter(e=>e.cor&&e.texto);
 return {titulo,contexto:[...new Set(contexto.map(limpar).filter(Boolean))].join(' · '),fonte,
  ...(gradiente.length>1&&rotulos.length?{escala:{cores:gradiente,rotulos}}:{}),...(legenda.length?{legenda}:{})};
}
/** Janela dos eixos temporais; não confunde cobertura efetiva com anos sem valor. */
export function janelaTemporal(op:Record<string,unknown>){
 const arr=(v:unknown)=>Array.isArray(v)?v:v?[v]:[];
 const temporal=arr(op.series).some((s:any)=>s.type==='line'||s.type==='heatmap');if(!temporal)return '';
 const eixos=[...arr(op.xAxis),...arr(op.yAxis)];
 for(const eixo of eixos){const dados=(eixo as any)?.data;if(!Array.isArray(dados)||!dados.length)continue;const vals=dados.map(v=>String(v&&typeof v==='object'?v.value:v));
  if(vals.every(v=>/^(19|20)\d{2}$/.test(v))){const anos=vals.map(Number);return Math.min(...anos)===Math.max(...anos)?String(anos[0]):`${Math.min(...anos)}–${Math.max(...anos)}`;}}
 return '';
}
/** Quebra também URLs e códigos longos, para não cortar o rodapé em imagens estreitas. */
export function quebrarTextoImagem(texto:string,medir:(s:string)=>number,largura:number){
 const lines:string[]=[];let linha='';
 for(const palavra of texto.split(/\s+/).filter(Boolean)){
  const pedacos:string[]=[];let pedaco='';for(const letra of palavra){if(pedaco&&medir(pedaco+letra)>largura){pedacos.push(pedaco);pedaco=letra;}else pedaco+=letra;}if(pedaco)pedacos.push(pedaco);
  for(const p of pedacos){const proxima=linha?linha+' '+p:p;if(linha&&medir(proxima)>largura){lines.push(linha);linha=p;}else linha=proxima;}
 }
 if(linha)lines.push(linha);return lines;
}
