/**
 * Identifica quem chama /api/ia pelo token do Cloudflare Access (cabeçalho Cf-Access-Jwt-Assertion).
 * A assinatura é conferida com as chaves públicas da equipe; só um token válido, da aplicação certa
 * e dentro do prazo, devolve o e-mail. A lista de quem pode entrar fica na política do Access;
 * IA_EMAILS (opcional) repete a lista no Worker, como segunda barreira.
 *
 * Variáveis: ACCESS_TEAM (ex.: lapam.cloudflareaccess.com) e ACCESS_AUD (Application Audience da
 * aplicação no Access). No desenvolvimento local (wrangler dev), IA_DEV_EMAIL em .dev.vars dispensa o login.
 */
const chaves = { porKid: new Map(), ate: 0 };

const texto = new TextEncoder();
function base64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const json = (s) => JSON.parse(new TextDecoder().decode(base64url(s)));

async function chave(env, kid) {
  if (Date.now() > chaves.ate || !chaves.porKid.has(kid)) {
    const r = await fetch(`https://${env.ACCESS_TEAM}/cdn-cgi/access/certs`);
    if (!r.ok) throw new Error(`certificados do Access indisponíveis (${r.status})`);
    const { keys } = await r.json();
    chaves.porKid.clear();
    for (const k of keys) {
      chaves.porKid.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    }
    chaves.ate = Date.now() + 3600_000;
  }
  return chaves.porKid.get(kid) ?? null;
}

/** E-mail de quem fez o pedido, ou null se não houver login válido. */
export async function identificar(request, env) {
  if (env.IA_DEV_EMAIL && new URL(request.url).hostname === 'localhost') return env.IA_DEV_EMAIL;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM || !env.ACCESS_AUD) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const [cab, corpo, assinatura] = partes;
    const h = json(cab);
    if (h.alg !== 'RS256') return null;
    const k = await chave(env, h.kid);
    if (!k) return null;
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, base64url(assinatura), texto.encode(`${cab}.${corpo}`));
    if (!ok) return null;
    const c = json(corpo);
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    const agora = Date.now() / 1000;
    if (!aud.includes(env.ACCESS_AUD) || c.iss !== `https://${env.ACCESS_TEAM}` || !(c.exp > agora)) return null;
    if (typeof c.email !== 'string' || !c.email) return null;
    const email = c.email.toLowerCase();
    if (env.IA_EMAILS) {
      const lista = env.IA_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
      if (!lista.includes(email)) return null;
    }
    return email;
  } catch {
    return null;
  }
}
