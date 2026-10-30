/**
 * Conferência de respostas da IA pelo especialista RAIS (agente local do LAPAM, que recalcula os números a partir
 * dos brutos). Etapa 1: a página /ia monta no navegador o pedido (formato "conferencia-rais/1") e a pessoa o baixa;
 * o Worker só diz quem pode pedir.
 *
 * Quem tem acesso à IA (política do Access e IA_EMAILS) pode pedir. CONFERENCIA_EMAILS (opcional, e-mails
 * separados por vírgula) restringe a uma lista; como o repositório é público, ela fica fora do wrangler.jsonc:
 * wrangler secret put CONFERENCIA_EMAILS (ou segredo no painel da Cloudflare).
 */

/** O e-mail do Access pode pedir conferência? Sem login, não; sem CONFERENCIA_EMAILS, todos com acesso à IA. */
export function podeConferir(email, env) {
  if (typeof email !== 'string' || !email.trim()) return false;
  if (typeof env?.CONFERENCIA_EMAILS !== 'string' || !env.CONFERENCIA_EMAILS.trim()) return true;
  const lista = env.CONFERENCIA_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return lista.includes(email.trim().toLowerCase());
}
