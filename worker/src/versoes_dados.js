// Um URL com data só é imutável quando existe um índice congelado de ETags.
// Ao substituir um objeto, o publicador arquiva os bytes da edição anterior.
const indices = new WeakMap();
const semAspas = s => s.replace(/^"|"$/g, '');
export const porConteudo = chave => /_[a-f0-9]{16,64}\.(?:json(?:\.gz)?|ndjson|parquet|bin|csv(?:\.zip)?|dta|rds)$/.test(chave);
export const chaveArquivo = etag => 'gold/versoes/objetos/' + semAspas(etag);

export async function referenciaVersao(bucket, versao, chave) {
  let cache = indices.get(bucket);
  if (!cache) { cache = new Map(); indices.set(bucket, cache); }
  if (!cache.has(versao)) {
    const p = (async () => {
      const objeto = await bucket.get(`gold/versoes/${versao}.json`);
      if (!objeto) return null;
      const m = await objeto.json();
      if (m.versao !== 1 || m.edicao !== versao || !m.arquivos) throw new Error('Índice de versão inválido');
      return m;
    })();
    cache.set(versao,p);
    p.then(m=>{if(!m)cache.delete(versao);},()=>cache.delete(versao));
    if (cache.size > 16) cache.delete(cache.keys().next().value);
  }
  const ref = (await cache.get(versao))?.arquivos[chave];
  if (!ref) return null;
  if (!/^"[a-f0-9]{32}(?:-\d+)?"$/.test(ref.etag) || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0) throw new Error('Objeto de versão inválido');
  return ref;
}

export async function objetoVersao(bucket, chave, ref, request) {
  const head = request.method === 'HEAD';
  let obj = head ? await bucket.head(chave) : await bucket.get(chave,{range:request.headers,onlyIf:{etagMatches:semAspas(ref.etag)}});
  if (obj && obj.httpEtag === ref.etag && obj.size === ref.bytes && (head || 'body' in obj)) return obj;
  if (obj && 'body' in obj) await obj.body.cancel();
  obj = head ? await bucket.head(chaveArquivo(ref.etag)) : await bucket.get(chaveArquivo(ref.etag),{range:request.headers});
  if (!obj || obj.size !== ref.bytes || (obj.customMetadata?.origem_etag !== semAspas(ref.etag) && obj.httpEtag !== ref.etag)) {
    if (obj && 'body' in obj) await obj.body.cancel();
    return null;
  }
  return obj;
}
