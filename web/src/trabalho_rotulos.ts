import {idioma} from './idioma';

const EN:Record<string,Record<string,string>>={
 sexo:{'1':'Male','2':'Female'},
 raca_cor:{'1':'Indigenous','2':'White','4':'Black','6':'Asian','8':'Brown (parda)','9':'Not identified'},
 escolaridade:{'1':'Illiterate','2':'Less than five years of primary school','3':'Fifth year of primary school completed','4':'Sixth to ninth year of primary school','5':'Primary/lower secondary school completed','6':'Upper secondary school incomplete','7':'Upper secondary school completed','8':'Higher education incomplete','9':'Higher education completed','10':"Master’s degree",'11':'Doctoral degree'},
 faixa_idade:{'1':'Up to 17 years','2':'18 to 24 years','3':'25 to 29 years','4':'30 to 39 years','5':'40 to 49 years','6':'50 to 64 years','7':'65 years or older'},
};

/** Códigos e rótulos da fonte são preservados; a tradução só afeta a tela/exportação localizada. */
export function nomeGrupoTrabalho(dim:string,codigo:unknown,original:string){
 return idioma()==='en'?(EN[dim]?.[String(codigo)]??original):original;
}
