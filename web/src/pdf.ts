/**
 * Gerador de PDF sem dependências: texto e tabelas em Helvetica (WinAnsi), páginas A4, paginação com cabeçalho de
 * tabela repetido, quebra de linha nas células (nada é truncado) e tabelas largas divididas em blocos de colunas
 * (a primeira coluna se repete). O arquivo é um PDF 1.4 válido (xref, trailer, Info), gerado e baixado pelo
 * navegador, sem passar pela impressão.
 */
export type BlocoPdf =
  | { tipo: 'titulo'; texto: string; nivel: 1 | 2 | 3 }
  | { tipo: 'paragrafo'; texto: string; pequeno?: boolean }
  | { tipo: 'ficha'; linhas: [string, string][] }
  | { tipo: 'tabela'; titulo?: string; colunas: string[]; linhas: string[][]; texto: boolean[]; linhaTotal?: number; notas?: string[] };
export type DocumentoPdf = { titulo: string; rodape: string; blocos: BlocoPdf[] };

// larguras da Helvetica (AFM, milésimos de em) para os códigos 32 a 126
const LARGURAS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

const ESPECIAIS: Record<string, number> = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80 };
const SUBSTITUTOS: Record<string, string> = { '−': '-', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '≠': '!=', '≈': '~', '′': "'", '″': '"', ' ': ' ', '\t': ' ' };

/** Texto → bytes WinAnsi (o que a Helvetica padrão do PDF desenha); o que não existe nela vira um equivalente em ASCII. */
export function paraWinAnsi(s: string): number[] {
  const bytes: number[] = [];
  for (const c of s.normalize('NFC')) {
    const sub = SUBSTITUTOS[c];
    if (sub !== undefined) { for (const x of sub) bytes.push(x.charCodeAt(0)); continue; }
    const cod = c.codePointAt(0)!;
    if (ESPECIAIS[c] !== undefined) bytes.push(ESPECIAIS[c]);
    else if ((cod >= 32 && cod < 127) || (cod >= 160 && cod <= 255)) bytes.push(cod);
    else if (cod === 10 || cod === 13) bytes.push(32);
    else if (cod >= 32) bytes.push(63);
  }
  return bytes;
}

const larguraByte = (b: number) => {
  if (b >= 32 && b < 127) return LARGURAS[b - 32];
  if (b >= 192) { // letras acentuadas: a largura da letra-base
    const base = String.fromCharCode(b).normalize('NFD')[0].charCodeAt(0);
    return base >= 32 && base < 127 ? LARGURAS[base - 32] : 556;
  }
  return 556;
};
/** Largura do texto em pontos. */
const largura = (s: string, corpo: number, negrito = false) => paraWinAnsi(s).reduce((t, b) => t + larguraByte(b), 0) * corpo / 1000 * (negrito ? 1.07 : 1);

/** Quebra o texto em linhas de no máximo `max` pontos (palavras longas são cortadas ao meio, nunca perdidas). */
export function quebrar(texto: string, max: number, corpo: number, negrito = false): string[] {
  const saida: string[] = [];
  for (const paragrafo of String(texto ?? '').split(/\r?\n/)) {
    let linha = '';
    for (let palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      while (largura(palavra, corpo, negrito) > max) { // palavra maior que a coluna
        let k = palavra.length;
        while (k > 1 && largura(palavra.slice(0, k), corpo, negrito) > max) k--;
        if (linha) { saida.push(linha); linha = ''; }
        saida.push(palavra.slice(0, k));
        palavra = palavra.slice(k);
      }
      const tentativa = linha ? `${linha} ${palavra}` : palavra;
      if (linha && largura(tentativa, corpo, negrito) > max) { saida.push(linha); linha = palavra; } else linha = tentativa;
    }
    saida.push(linha);
  }
  return saida.length ? saida : [''];
}

const hex = (s: string) => `<${paraWinAnsi(s).map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
const n2 = (x: number) => (Math.round(x * 100) / 100).toString();

const MARGEM = 40;
const RODAPE = 28;

type Pagina = { ops: string[] };

class Folha {
  paginas: Pagina[] = [];
  y = 0;
  constructor(readonly larguraPag: number, readonly alturaPag: number) { this.nova(); }
  get util() { return this.larguraPag - 2 * MARGEM; }
  get fundo() { return MARGEM + RODAPE / 2; }
  nova() { this.paginas.push({ ops: [] }); this.y = this.alturaPag - MARGEM; }
  get ops() { return this.paginas.at(-1)!.ops; }
  /** Garante `h` pontos livres; senão, página nova (devolve true). */
  espaco(h: number) {
    if (this.y - h < this.fundo) { this.nova(); return true; }
    return false;
  }
  texto(s: string, x: number, y: number, corpo: number, negrito = false, cinza = false) {
    if (!s) return;
    this.ops.push(`BT ${cinza ? '0.35 g' : '0 g'} /${negrito ? 'F2' : 'F1'} ${n2(corpo)} Tf ${n2(x)} ${n2(y)} Td ${hex(s)} Tj ET`);
  }
  retangulo(x: number, y: number, w: number, h: number, cinza: number) {
    this.ops.push(`${n2(cinza)} g ${n2(x)} ${n2(y)} ${n2(w)} ${n2(h)} re f 0 g`);
  }
  linha(x1: number, y1: number, x2: number, y2: number) {
    this.ops.push(`0.6 G 0.5 w ${n2(x1)} ${n2(y1)} m ${n2(x2)} ${n2(y2)} l S`);
  }
}

function paragrafo(f: Folha, texto: string, corpo: number, negrito = false, cinza = false, recuo = 0, depois = 4) {
  const lh = corpo * 1.3;
  for (const l of quebrar(texto, f.util - recuo, corpo, negrito)) {
    f.espaco(lh);
    f.y -= lh;
    f.texto(l, MARGEM + recuo, f.y + corpo * 0.25, corpo, negrito, cinza);
  }
  f.y -= depois;
}

/** Larguras das colunas: pelo conteúdo (cabeçalho e até 300 linhas), limitadas, e repartidas pela largura útil. */
function larguraDasColunas(colunas: string[], linhas: string[][], texto: boolean[], corpo: number, util: number): number[] {
  const pad = 8;
  const natural = colunas.map((c, j) => {
    let m = largura(c, corpo, true);
    const amostra = linhas.length > 300 ? linhas.filter((_, i) => i % Math.ceil(linhas.length / 300) === 0) : linhas;
    for (const l of amostra) m = Math.max(m, largura(l[j] ?? '', corpo));
    return Math.min(m, texto[j] ? util * 0.45 : util * 0.3) + pad;
  });
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= util) return natural.map((w) => w + (util - total) * (w / total)); // sobra proporcional
  return natural;
}

function tabela(f: Folha, b: Extract<BlocoPdf, { tipo: 'tabela' }>) {
  if (b.titulo) { f.espaco(30); paragrafo(f, b.titulo, 10, true, false, 0, 3); }
  // corpo menor quando a tabela é larga; se ainda não couber, divide em blocos de colunas (a primeira se repete)
  let corpo = 8;
  let larguras = larguraDasColunas(b.colunas, b.linhas, b.texto, corpo, f.util);
  if (larguras.reduce((a, c) => a + c, 0) > f.util) {
    corpo = 6.5;
    larguras = larguraDasColunas(b.colunas, b.linhas, b.texto, corpo, f.util);
  }
  // blocos de colunas: a primeira coluna (o rótulo da linha) se repete em todos
  const grupos: number[][] = [];
  let atual: number[] = [];
  let soma = larguras[0];
  for (let j = 1; j < b.colunas.length; j++) {
    if (atual.length && soma + larguras[j] > f.util + 0.5) { grupos.push(atual); atual = []; soma = larguras[0]; }
    atual.push(j);
    soma += larguras[j];
  }
  if (atual.length || !grupos.length) grupos.push(atual);
  const lh = corpo * 1.25;
  grupos.forEach((g, gi) => {
    const cols = [0, ...g];
    const ws = cols.map((j) => larguras[j]);
    // cada bloco de colunas é reescalado para ocupar a largura útil quando sobra espaço
    const tot = ws.reduce((a, c) => a + c, 0);
    const esc = f.util / tot;
    const wf = ws.map((w) => w * esc);
    if (grupos.length > 1) paragrafo(f, `(colunas ${cols.map((j) => j + 1).join(', ')} de ${b.colunas.length})`, 7, false, true, 0, 2);
    const cabecalho = () => {
      const linhasCab = cols.map((j, k) => quebrar(b.colunas[j], wf[k] - 8, corpo, true));
      const h = Math.max(...linhasCab.map((l) => l.length)) * lh + 6;
      f.espaco(h + lh * 2);
      f.retangulo(MARGEM, f.y - h, f.util, h, 0.9);
      let x = MARGEM;
      cols.forEach((j, k) => {
        linhasCab[k].forEach((l, i) => {
          const dx = b.texto[j] ? 4 : wf[k] - 4 - largura(l, corpo, true);
          f.texto(l, x + dx, f.y - 3 - (i + 1) * lh + corpo * 0.3, corpo, true);
        });
        x += wf[k];
      });
      f.linha(MARGEM, f.y, MARGEM + f.util, f.y);
      f.linha(MARGEM, f.y - h, MARGEM + f.util, f.y - h);
      f.y -= h;
    };
    cabecalho();
    b.linhas.forEach((linha, i) => {
      const celulas = cols.map((j, k) => quebrar(linha[j] ?? '', wf[k] - 8, corpo, i === b.linhaTotal));
      const h = Math.max(...celulas.map((c) => c.length)) * lh + 3;
      if (f.espaco(h)) cabecalho();
      let x = MARGEM;
      cols.forEach((j, k) => {
        celulas[k].forEach((l, m) => {
          const dx = b.texto[j] ? 4 : wf[k] - 4 - largura(l, corpo, i === b.linhaTotal);
          f.texto(l, x + dx, f.y - (m + 1) * lh + corpo * 0.2, corpo, i === b.linhaTotal);
        });
        x += wf[k];
      });
      f.y -= h;
      f.linha(MARGEM, f.y, MARGEM + f.util, f.y);
    });
    f.y -= 6;
  });
  for (const n of b.notas ?? []) paragrafo(f, n, 7.5, false, true, 0, 2);
  f.y -= 8;
}

/** PDF 1.4 completo (A4; paisagem quando alguma tabela tem mais de 7 colunas). */
export function paraPdf(doc: DocumentoPdf): Uint8Array {
  const paisagem = doc.blocos.some((b) => b.tipo === 'tabela' && b.colunas.length > 7);
  const f = paisagem ? new Folha(842, 595) : new Folha(595, 842);
  paragrafo(f, doc.titulo, 15, true, false, 0, 8);
  for (const b of doc.blocos) {
    if (b.tipo === 'titulo') {
      f.espaco(40);
      f.y -= b.nivel === 1 ? 10 : 4;
      paragrafo(f, b.texto, b.nivel === 1 ? 12.5 : b.nivel === 2 ? 10.5 : 9.5, true, false, 0, 3);
    } else if (b.tipo === 'paragrafo') paragrafo(f, b.texto, b.pequeno ? 8 : 9.5, false, b.pequeno, 0, 5);
    else if (b.tipo === 'ficha') for (const [k, v] of b.linhas) paragrafo(f, `${k}: ${v}`, 8, false, true, 0, 1);
    else tabela(f, b);
  }
  // rodapé com a página em cada folha
  const total = f.paginas.length;
  f.paginas.forEach((p, i) => {
    const s = `${doc.rodape}  ·  ${i + 1}/${total}`;
    p.ops.push(`BT 0.4 g /F1 7.5 Tf ${n2(MARGEM)} ${n2(MARGEM - 6)} Td ${hex(s)} Tj ET`);
  });

  const objetos: string[] = [];
  const add = (corpo: string) => { objetos.push(corpo); return objetos.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGINAS'); // preenchido adiante
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const idPaginas: number[] = [];
  for (const p of f.paginas) {
    const conteudo = p.ops.join('\n');
    const idConteudo = add(`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`);
    idPaginas.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f.larguraPag} ${f.alturaPag}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idConteudo} 0 R >>`));
  }
  objetos[1] = `<< /Type /Pages /Kids [${idPaginas.map((i) => `${i} 0 R`).join(' ')}] /Count ${idPaginas.length} >>`;
  const idInfo = add(`<< /Title ${hex(doc.titulo)} /Producer ${hex('LAPAM/UFG - Pergunte aos dados')} >>`);

  // o conteúdo só tem ASCII (strings hexadecimais): um caractere = um byte
  let saida = '%PDF-1.4\n';
  const posicoes: number[] = [];
  objetos.forEach((o, i) => { posicoes.push(saida.length); saida += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = saida.length;
  saida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posicoes.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  saida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info ${idInfo} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(saida.length);
  for (let i = 0; i < saida.length; i++) bytes[i] = saida.charCodeAt(i) & 0xff;
  return bytes;
}
