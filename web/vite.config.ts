import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const PASTA_DADOS = path.resolve(__dirname, process.env.DATA_DIR ?? '../data');
// microdados da RAIS e do CAGED (pipeline/microdados.py): fora do projeto e do Dropbox
const PASTA_MICRO = path.resolve(process.env.TRABALHO_MICRO ?? 'D:/LVBERNARDELLI/finbra_micro');

/**
 * Serve a pasta data/ em /dados/ com suporte a Range, como o Worker faz em produção a partir do R2.
 * Assim o DuckDB do navegador lê os mesmos arquivos localmente.
 */
function dadosLocais(): Plugin {
  const servir: Connect.NextHandleFunction = (req, res) => {
    // /v/<versão>/ só existe para renovar o cache do navegador; o arquivo é o mesmo
    const relativo = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/v\/[0-9]+\//, '/');
    if (process.env.DEBUG_DADOS) console.log('[dados]', req.method, relativo, req.headers.range ?? '-');
    const raiz = /^[\\/]silver[\\/]trabalho[\\/]micro[\\/]/.test(relativo) ? PASTA_MICRO : PASTA_DADOS;
    const arquivo = path.join(raiz, relativo);
    const permitido = /^[\\/](silver|gold)[\\/]/.test(relativo) && arquivo.startsWith(raiz);
    if (!permitido || !fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
      res.statusCode = 404;
      res.end('não encontrado');
      return;
    }
    const tamanho = fs.statSync(arquivo).size;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', arquivo.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    let inicio = 0;
    let fim = tamanho - 1;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m) {
      if (m[1] === '') inicio = Math.max(0, tamanho - Number(m[2]));
      else {
        inicio = Number(m[1]);
        if (m[2] !== '') fim = Math.min(Number(m[2]), tamanho - 1);
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${inicio}-${fim}/${tamanho}`);
    }
    if (req.method === 'HEAD') {
      // o navegador descarta o Range no HEAD, mas o DuckDB-WASM só usa leitura parcial se o HEAD
      // responder 206; HEAD não tem corpo, então anunciar o arquivo inteiro como 206 é inofensivo
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes 0-${tamanho - 1}/${tamanho}`);
      res.setHeader('Content-Length', String(tamanho));
      res.end();
      return;
    }
    res.setHeader('Content-Length', String(fim - inicio + 1));
    fs.createReadStream(arquivo, { start: inicio, end: fim }).pipe(res);
  };
  return {
    name: 'dados-locais',
    configureServer: (s) => void s.middlewares.use('/dados', servir),
    configurePreviewServer: (s) => void s.middlewares.use('/dados', servir),
  };
}

export default defineConfig({
  plugins: [react(), dadosLocais()],
  // /api (perguntas com IA) vai para o Worker local: cd worker; npx wrangler dev (porta 8787)
  server: { port: 5180, strictPort: true, proxy: { '/api': 'http://localhost:8787' } },
  preview: { port: 5180, strictPort: true, proxy: { '/api': 'http://localhost:8787' } },
});
