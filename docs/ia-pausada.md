# Pausa temporária da IA

A aba da IA está oculta no computador e no celular. Links antigos para `/ia`
abrem o Raio X, e `/trabalho/ia` abre o painel de trabalho. Os filtros de
território e ano são preservados quando aplicáveis, sem carregar a conversa.

O Worker exige `IA_HABILITADA="true"` para atender qualquer rota `/api/ia`.
Na ausência dessa opção ou com valor diferente, responde `503 ia_desativada`
antes de autenticar, ler/gravar o histórico ou chamar a Anthropic. Assim,
abas antigas e pedidos diretos também ficam bloqueados.

Para reativar, ajustar `IA_HABILITADA` para `true` em `web/src/App.tsx` e
para `"true"` em `worker/wrangler.jsonc`, validar e publicar o site.
Código, credenciais e conversas existentes são preservados. Os dados dos
painéis, downloads, API para R/Stata e automações continuam independentes da IA.
