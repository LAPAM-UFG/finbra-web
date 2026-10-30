/**
 * Conferência de respostas da IA pelo especialista RAIS (agente local do LAPAM, que recalcula os números a partir
 * dos brutos). Etapa 1: a página /ia monta no navegador o pedido (formato "conferencia-rais/1") e a pessoa o baixa;
 * o Worker só diz quem pode pedir.
 *
 * Variável: CONFERENCIA_EMAILS, e-mails separados por vírgula. Como o repositório é público, fica fora do
 * wrangler.jsonc: wrangler secret put CONFERENCIA_EMAILS (ou segredo no painel da Cloudflare).
 */

/** O e-mail do Access está entre os que podem pedir conferência? Sem login ou sem a variável, não. */
export function podeConferir(email, env) {
  if (typeof email !== 'string' || !email || typeof env?.CONFERENCIA_EMAILS !== 'string') return false;
  const lista = env.CONFERENCIA_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return lista.includes(email.trim().toLowerCase());
}
