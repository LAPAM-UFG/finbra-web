/**
 * Rastreabilidade dos indicadores da LRF: de cada indicador ao demonstrativo (relatório e anexo) e às contas que o compõem, as
 * mesmas que pipeline/lrf.py usa no gold. O link abre a página de demonstrativos do mesmo ente e exercício, no anexo certo, com
 * essas contas em destaque. Nada é recalculado: o demonstrativo mostra os valores como o ente os entregou ao SICONFI.
 */
import { t } from './idioma';

export type ChaveRastro = 'pessoal' | 'dcl' | 'saude' | 'mde' | 'fundeb' | 'primario' | 'rreo14';
export type Rastro = { relatorio: 'RGF' | 'RREO'; anexo: string; contas: string[]; rotulo: () => string };

const RREO14 = 'RREO-Anexo 14';
const CONTAS_SAUDE = ['AplicacaoTotalDasDespesasComAcoesEServicosPublicosDeSaude'];
const CONTAS_MDE = ['MinimoAnualDasReceitasDeImpostosNaManutencaoEDesenvolvimentoDoEnsino'];
const CONTAS_FUNDEB = ['MinimoAnualDoFUNDEBNaRemuneracao'];
const CONTAS_PRIMARIO = ['ResultadoPrimario', 'ResultadoNominal'];

export const RASTRO: Record<ChaveRastro, Rastro> = {
  pessoal: {
    relatorio: 'RGF', anexo: 'RGF-Anexo 01', rotulo: () => t('Despesa com pessoal ÷ RCL', 'Personnel expenditure ÷ RCL'),
    contas: ['ReceitaCorrenteLiquidaLimiteLegal', 'ReceitaCorrenteLiquidaAjustada', 'DespesaComPessoalTotal', 'LimiteMaximoDespesaComPessoalTotal'],
  },
  dcl: {
    relatorio: 'RGF', anexo: 'RGF-Anexo 02', rotulo: () => t('Dívida consolidada líquida ÷ RCL', 'Net consolidated debt ÷ RCL'),
    contas: ['DividaConsolidada', 'RGF2ReceitaCorrenteLiquida', 'ReceitaCorrenteLiquidaAjustadaParaCalculoDosLimitesDeEndividamento', 'PercentualDaDCLSobreARCL'],
  },
  saude: { relatorio: 'RREO', anexo: RREO14, rotulo: () => t('Aplicação em saúde', 'Health spending'), contas: CONTAS_SAUDE },
  mde: { relatorio: 'RREO', anexo: RREO14, rotulo: () => t('Aplicação em educação (MDE)', 'Education spending (MDE)'), contas: CONTAS_MDE },
  fundeb: { relatorio: 'RREO', anexo: RREO14, rotulo: () => t('FUNDEB na remuneração', 'FUNDEB on education pay'), contas: CONTAS_FUNDEB },
  primario: { relatorio: 'RREO', anexo: RREO14, rotulo: () => t('Resultado primário', 'Primary balance'), contas: CONTAS_PRIMARIO },
  rreo14: {
    relatorio: 'RREO', anexo: RREO14, rotulo: () => t('saúde, educação, FUNDEB e resultado primário', 'health, education, FUNDEB and primary balance'),
    contas: [...CONTAS_SAUDE, ...CONTAS_MDE, ...CONTAS_FUNDEB, ...CONTAS_PRIMARIO],
  },
};

export const chaveDoRastro = (v: string | null): ChaveRastro | null => (v !== null && Object.hasOwn(RASTRO, v) ? (v as ChaveRastro) : null);

/** Valor do parâmetro `anexo` da página de demonstrativos: "RGF|RGF-Anexo 01". */
export const valorAnexo = (r: Rastro) => `${r.relatorio}|${r.anexo}`;

/** Endereço do demonstrativo do mesmo ente e exercício, no anexo do indicador e com as contas dele em destaque. */
export function urlDemonstrativo(ente: number, ano: number, chave: ChaveRastro): string {
  const p = new URLSearchParams({ ente: String(ente), ano: String(ano), anexo: valorAnexo(RASTRO[chave]), destaque: chave });
  return `/lrf/demonstrativos?${p}`;
}

/**
 * Acesso genérico aos demonstrativos do mesmo ente e exercício, sem anexo nem destaque. Serve onde o gold não tem proveniência
 * inequívoca (a RCL pode vir do RGF anexo 1, do RGF anexo 2 ou do RREO anexo 14, conforme o que o ente entregou).
 */
export const urlDemonstrativos = (ente: number, ano: number) => `/lrf/demonstrativos?${new URLSearchParams({ ente: String(ente), ano: String(ano) })}`;

/** Aviso de anexo indisponível: pertence ao ente e ao exercício em que foi gerado (o anexo some da URL na hora, então não serve de chave). */
export type AvisoAnexo = { ente: number; ano: number; texto: string };
export const avisoDoContexto = (a: AvisoAnexo | null, ente: number | undefined, ano: number | undefined): string | null =>
  a && a.ente === ente && a.ano === ano ? a.texto : null;

/** A conta (cod_conta) é uma das que compõem o indicador? Os códigos do gold valem como prefixo (a API acrescenta sufixos em alguns anos). */
export const contaDoRastro = (cod: string, chave: ChaveRastro) => RASTRO[chave].contas.some((c) => cod === c || cod.startsWith(c));
