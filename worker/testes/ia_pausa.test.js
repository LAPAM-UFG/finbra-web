import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

test('a pausa bloqueia toda a API da IA antes de autenticar, ler dados ou consumir créditos', async () => {
  const indisponivel = new Proxy({}, { get() { throw new Error('A IA pausada acessou um serviço externo'); } });
  for (const habilitada of [undefined, 'false', '', true, 'TRUE']) {
    const env = new Proxy({ IA_HABILITADA: habilitada }, {
      get(target, key) { return key === 'IA_HABILITADA' ? target[key] : indisponivel.chamada; },
    });
    for (const [path, method] of [['/api/ia', 'POST'], ['/api/ia/estado', 'GET'], ['/api/ia/entrar', 'GET'], ['/api/ia/conversas', 'GET'], ['/api/ia/conversas/existente', 'DELETE']]) {
      const request = new Request(`https://painel.exemplo${path}`, { method, ...(method === 'POST' ? { body: 'nem precisa ser JSON' } : {}) });
      const response = await worker.fetch(request, env);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.deepEqual(await response.json(), {
        erro: 'A IA está temporariamente desativada. Os painéis e downloads continuam disponíveis.',
        codigo: 'ia_desativada', configurada: false, pode_conferir: false,
      });
      assert.equal(request.bodyUsed, false);
    }
  }
});

test('a pausa mantém os arquivos estáticos disponíveis', async () => {
  const response = await worker.fetch(new Request('https://painel.exemplo/trabalho'), {
    IA_HABILITADA: 'false', ASSETS: { fetch: () => new Response('painel') },
  });
  assert.equal(await response.text(), 'painel');
});
