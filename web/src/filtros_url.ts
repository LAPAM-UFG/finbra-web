/**
 * Regras puras dos filtros globais (ano, uf, ente) lidos da URL e do teclado da busca de ente. Sem React nem textos:
 * contexto.tsx monta as mensagens a partir dos avisos estruturados daqui, e os testes exercitam estas funções direto.
 */

export const UFS_BR = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

/** Brasília (município do DF) e o ente Distrito Federal são o mesmo recorte nesta interface: vale o ente 53. */
export const COD_BRASILIA = 5300108;
export const COD_DF = 53;

/**
 * Fernando de Noronha: distrito estadual de Pernambuco, sem declaração fiscal própria (não está em entes/indicadores/lrf), mas com dados no
 * FNS (fns_municipios, cod_ibge 2605459), como já documentado em ia_territorio.ts (NORONHA, consultaSoFns). Só o cadastro EFETIVO da área
 * /datasus o inclui (cadastroEfetivoSaude); o cadastro publicado, as rotas saude_entes/entes e as outras áreas não mudam. A esfera 'M' é só
 * para a compatibilidade com essas fontes (as páginas pedem municípios por esfera 'M'); na interface ele nunca é "município" (tipoDeEnte).
 */
export const COD_NORONHA = 2605459;
export const ENTE_NORONHA = { cod_ibge: COD_NORONHA, nome: 'Fernando de Noronha', uf: 'PE', esfera: 'M' as const, capital: false };

/** Cadastro da área de saúde: o publicado mais Noronha (sem duplicar se um dia vier no cadastro e sem alterar a lista recebida). */
export function cadastroEfetivoSaude<E extends { cod_ibge: number }>(entes: readonly E[], noronha: E): E[] {
  return entes.some((e) => e.cod_ibge === COD_NORONHA) ? [...entes] : [...entes, noronha];
}

export type TipoEnte = 'municipio' | 'estado' | 'df' | 'distrito_estadual';
export function tipoDeEnte(e: { cod_ibge: number; esfera: 'M' | 'E' | 'D' }): TipoEnte {
  if (e.cod_ibge === COD_NORONHA) return 'distrito_estadual';
  return e.esfera === 'M' ? 'municipio' : e.esfera === 'E' ? 'estado' : 'df';
}

const limpo = (v: string | null | undefined) => (v ?? '').trim();
/** Valor da URL para mostrar na tela: sem espaços nas pontas e sem textos enormes. */
const mostrar = (v: string) => (v.length > 32 ? `${v.slice(0, 32)}…` : v);

/** UF: ignora caixa e espaços; vazio é "sem UF"; qualquer outra coisa é inválida (devolvida como veio, para o aviso). */
export function lerUf(bruto: string | null | undefined): { uf: string | null; invalida: string | null } {
  const v = limpo(bruto);
  if (!v) return { uf: null, invalida: null };
  const maiuscula = v.toUpperCase();
  return UFS_BR.includes(maiuscula) ? { uf: maiuscula, invalida: null } : { uf: null, invalida: mostrar(v) };
}

/** Ente: só dígitos; 5300108 (Brasília) vira 53 (Distrito Federal) quando o cadastro tem o 53; código fora do cadastro é inválido. */
export function lerEnte<E extends { cod_ibge: number }>(
  bruto: string | null | undefined,
  buscar: (cod: number) => E | undefined,
): { ente: E | null; invalido: string | null } {
  const v = limpo(bruto);
  if (!v) return { ente: null, invalido: null };
  if (!/^\d{1,9}$/.test(v)) return { ente: null, invalido: mostrar(v) };
  let cod = Number(v);
  if (cod === COD_BRASILIA && buscar(COD_DF)) cod = COD_DF;
  const e = buscar(cod);
  return e ? { ente: e, invalido: null } : { ente: null, invalido: mostrar(v) };
}

export type PedidoAno =
  | { tipo: 'nenhum' }
  | { tipo: 'ultimo' }
  /** numérico (4 dígitos) ainda que fora da base */
  | { tipo: 'ano'; valor: number }
  | { tipo: 'texto'; valor: string };

export function lerAno(bruto: string | null | undefined): PedidoAno {
  const v = limpo(bruto);
  if (!v) return { tipo: 'nenhum' };
  if (v.toLowerCase() === 'ultimo') return { tipo: 'ultimo' };
  if (/^[1-9]\d{3}$/.test(v)) return { tipo: 'ano', valor: Number(v) };
  return { tipo: 'texto', valor: mostrar(v) };
}

export type AvisoUrl =
  | { tipo: 'uf_invalida'; valor: string }
  | { tipo: 'ente_invalido'; valor: string }
  | { tipo: 'uf_diverge'; uf: string; enteUf: string }
  | { tipo: 'ano_fora'; pedido: number; usado: number }
  | { tipo: 'ano_invalido'; valor: string; usado: number }
  | { tipo: 'ultimo_indisponivel'; usado: number };

export type EntradaUrl = { ano: string | null; uf: string | null; ente: string | null };
export type Cenario = {
  /** anos do filtro desta área (finanças, RAIS ou fontes da saúde) */
  anos: number[];
  /** "último ano de cada fonte" só existe na saúde */
  aceitaUltimo: boolean;
  /** as páginas de trabalho e saúde já avisam sozinhas quando um ano numérico está fora da base */
  avisoProprioDeAnoNumerico: boolean;
};

export type FiltrosLidos<E extends { cod_ibge: number; uf: string }> = {
  ano: number; ultimo: boolean; ente: E | null; uf: string | null;
  /** só ano numérico fora da base (nunca NaN): é o que as páginas com aviso próprio leem */
  anoForaDaBase: number | null;
  avisos: AvisoUrl[];
  /** parâmetros da URL que não valem (o que o botão do aviso remove); os válidos e os da página ficam */
  paraRemover: ('ano' | 'uf' | 'ente')[];
};

export function lerFiltros<E extends { cod_ibge: number; uf: string }>(
  e: EntradaUrl, c: Cenario, buscar: (cod: number) => E | undefined,
): FiltrosLidos<E> {
  const avisos: AvisoUrl[] = [];
  const paraRemover: FiltrosLidos<E>['paraRemover'] = [];
  const padrao = c.anos.at(-1)!;

  const u = lerUf(e.uf);
  const en = lerEnte(e.ente, buscar);
  if (u.invalida) { avisos.push({ tipo: 'uf_invalida', valor: u.invalida }); paraRemover.push('uf'); }
  if (en.invalido) { avisos.push({ tipo: 'ente_invalido', valor: en.invalido }); paraRemover.push('ente'); }
  if (u.uf && en.ente && u.uf !== en.ente.uf) avisos.push({ tipo: 'uf_diverge', uf: u.uf, enteUf: en.ente.uf });

  const p = lerAno(e.ano);
  let ano = padrao;
  let ultimo = false;
  let anoForaDaBase: number | null = null;
  if (p.tipo === 'ultimo') {
    if (c.aceitaUltimo) ultimo = true;
    else { avisos.push({ tipo: 'ultimo_indisponivel', usado: padrao }); paraRemover.push('ano'); }
  } else if (p.tipo === 'ano') {
    if (c.anos.includes(p.valor)) ano = p.valor;
    else {
      anoForaDaBase = p.valor;
      if (!c.avisoProprioDeAnoNumerico) { avisos.push({ tipo: 'ano_fora', pedido: p.valor, usado: padrao }); paraRemover.push('ano'); }
    }
  } else if (p.tipo === 'texto') {
    avisos.push({ tipo: 'ano_invalido', valor: p.valor, usado: padrao });
    paraRemover.push('ano');
  }
  return { ano, ultimo, ente: en.ente, uf: en.ente?.uf ?? u.uf, anoForaDaBase, avisos, paraRemover };
}

// ---------------- busca de ente: teclado ----------------

export type EstadoBusca = {
  aberto: boolean; foco: number; total: number; texto: string;
  /** o usuário moveu a opção ativa com as setas desde que a lista abriu ou o texto mudou */
  navegou: boolean;
};
export type ResultadoTecla = {
  aberto: boolean; foco: number; navegou: boolean;
  /** índice da opção a escolher, ou null */
  selecionar: number | null;
  /** chamar preventDefault (setas não rolam a página; Enter só quando escolhe algo) */
  impedir: boolean;
};

export const focoValido = (foco: number, total: number) => (total <= 0 ? 0 : Math.min(Math.max(foco, 0), total - 1));

export function teclaBusca(tecla: string, s: EstadoBusca): ResultadoTecla {
  const foco = focoValido(s.foco, s.total);
  const base: ResultadoTecla = { aberto: s.aberto, foco, navegou: s.navegou, selecionar: null, impedir: false };
  if (tecla === 'ArrowDown' || tecla === 'ArrowUp') {
    // fechada: a seta só abre a lista (nada é escolhido nem fica "navegado")
    if (!s.aberto) return { ...base, aberto: true, impedir: true };
    if (s.total === 0) return { ...base, impedir: true };
    return { ...base, foco: focoValido(foco + (tecla === 'ArrowDown' ? 1 : -1), s.total), navegou: true, impedir: true };
  }
  if (tecla === 'Enter') {
    // só escolhe com a lista aberta e visível, e com texto digitado ou opção movida com as setas
    if (s.aberto && s.total > 0 && (s.texto.trim() !== '' || s.navegou)) return { ...base, selecionar: foco, impedir: true };
    return base;
  }
  if (tecla === 'Escape') return { ...base, aberto: false, navegou: false, impedir: s.aberto };
  return base;
}

/** Novo scrollTop da lista para a opção [topo, topo + altura) ficar visível; nenhum ajuste se já está. */
export function rolagemParaOpcao(topo: number, altura: number, rolagem: number, visivel: number): number {
  if (topo < rolagem) return topo;
  if (topo + altura > rolagem + visivel) return topo + altura - visivel;
  return rolagem;
}
