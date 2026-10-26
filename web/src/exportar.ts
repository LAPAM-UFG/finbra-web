/**
 * Exportação de tabelas em CSV (Excel em português: ";" e vírgula decimal, UTF-8 com BOM) e XLSX
 * (planilha "dados" + planilha "metadados"), sem bibliotecas: o .xlsx é um zip sem compressão.
 * Os números saem com a precisão completa, sem arredondar.
 */

export type Celula = string | number | boolean | null | undefined;
export type Tabela = { colunas: string[]; linhas: Celula[][]; metadados: [string, string][] };

// ---------------- CSV ----------------

function celulaCsv(v: Celula, decimal: string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', decimal) : '';
  const s = String(v);
  return /[";\n\r]/.test(s) || s.startsWith(' ') ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV com os metadados no topo, uma linha em branco e a tabela. */
export function paraCsv(t: Tabela, decimal = ','): string {
  const sep = decimal === ',' ? ';' : ',';
  const linhas = [
    ...t.metadados.map(([k, v]) => [k, v].map((c) => celulaCsv(c, decimal)).join(sep)),
    '',
    t.colunas.map((c) => celulaCsv(c, decimal)).join(sep),
    ...t.linhas.map((l) => l.map((c) => celulaCsv(c, decimal)).join(sep)),
  ];
  return '﻿' + linhas.join('\r\n') + '\r\n';
}

// ---------------- XLSX ----------------

const xml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
  // caracteres de controle não são válidos em XML
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colunaExcel(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function planilha(linhas: Celula[][]): string {
  const corpo = linhas.map((l, r) => {
    const celulas = l.map((v, c) => {
      const ref = `${colunaExcel(c)}${r + 1}`;
      if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
      if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
      if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${celulas}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${corpo}</sheetData></worksheet>`;
}

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of dados) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip sem compressão (método 0), suficiente para o Excel abrir o .xlsx. */
export function zip(arquivos: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [nome, texto] of arquivos) {
    const n = enc.encode(nome);
    const d = enc.encode(texto);
    const crc = crc32(d);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, d.length, true); local.setUint32(22, d.length, true);
    local.setUint16(26, n.length, true);
    partes.push(new Uint8Array(local.buffer), n, d);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, d.length, true); cd.setUint32(24, d.length, true);
    cd.setUint16(28, n.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), n);
    offset += 30 + n.length + d.length;
  }
  const tamanhoCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamanhoCentral, true); fim.setUint32(16, offset, true);
  const todas = [...partes, ...central, new Uint8Array(fim.buffer)];
  const saida = new Uint8Array(todas.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of todas) { saida.set(p, i); i += p.length; }
  return saida;
}

export type Planilha = { nome: string; linhas: Celula[][] };

/**
 * Nome válido de aba do Excel: até 31 caracteres, sem : \ / ? * [ ] e sem repetir os anteriores
 * (comparação sem diferenciar maiúsculas, como o Excel faz).
 */
function nomesDeAba(nomes: string[]): string[] {
  const usados = new Set<string>();
  return nomes.map((n, i) => {
    const base = (n.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim() || `aba ${i + 1}`).slice(0, 31);
    let nome = base;
    for (let k = 2; usados.has(nome.toLowerCase()); k++) nome = `${base.slice(0, 31 - String(k).length - 1)} ${k}`;
    usados.add(nome.toLowerCase());
    return nome;
  });
}

/** Pasta de trabalho com várias abas. */
export function paraXlsxAbas(abas: Planilha[]): Uint8Array {
  const nomes = nomesDeAba(abas.map((a) => a.nome));
  const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + `</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const livro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
    + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
    + nomes.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + `</sheets></workbook>`;
  const relsLivro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `</Relationships>`;
  return zip([
    ['[Content_Types].xml', tipos],
    ['_rels/.rels', rels],
    ['xl/workbook.xml', livro],
    ['xl/_rels/workbook.xml.rels', relsLivro],
    ...abas.map((a, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, planilha(a.linhas)]),
  ]);
}

export function paraXlsx(t: Tabela): Uint8Array {
  return paraXlsxAbas([
    { nome: 'dados', linhas: [t.colunas, ...t.linhas] },
    { nome: 'metadados', linhas: t.metadados.map(([k, v]) => [k, v]) },
  ]);
}

// ---------------- download ----------------

export function baixarArquivo(nome: string, conteudo: BlobPart, tipo: string) {
  const u = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = u;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

export function nomeArquivo(base: string) {
  const limpo = base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
  return `${limpo || 'consulta'}_${new Date().toISOString().slice(0, 10)}`;
}

export function exportar(base: string, formato: 'csv' | 'xlsx', tabela: Tabela, decimal: string) {
  const nome = nomeArquivo(base);
  if (formato === 'csv') baixarArquivo(`${nome}.csv`, paraCsv(tabela, decimal), 'text/csv;charset=utf-8');
  else baixarArquivo(`${nome}.xlsx`, paraXlsx(tabela) as BlobPart,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
