import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = '__Host-lula_admin';
const SESSION_SECONDS = 8 * 60 * 60;
export class AdminError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'AdminError'; this.code = code; this.status = status; }
}
export const digest = (value) => createHash('sha256').update(value).digest('hex');
const mac = (value, secret) => createHmac('sha256', secret).update(value).digest('base64url');
export function constantEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function authConfiguration(env = process.env) {
  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  const passwordHash = env.ADMIN_PASSWORD_HASH || '';
  const secret = env.ADMIN_SESSION_SECRET || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(passwordHash) || secret.length < 40) {
    throw new AdminError('ADMIN_NOT_CONFIGURED', 503);
  }
  return { email, passwordHash, secret, identity: digest(email + '\0' + passwordHash) };
}
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`;
}
export function checkCredentials(email, password, env = process.env) {
  const config = authConfiguration(env);
  const parts = config.passwordHash.split('$');
  const value = typeof password === 'string' && password.length <= 256 ? password : '';
  const matchesPassword = constantEqual(scryptSync(value, parts[1], 32).toString('hex'), parts[2]);
  return matchesPassword && constantEqual(digest(String(email).trim().toLowerCase()), digest(config.email));
}
export function createSession(env = process.env, now = Date.now()) {
  const config = authConfiguration(env);
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: config.identity, exp: Math.floor(now / 1000) + SESSION_SECONDS, nonce: randomBytes(18).toString('base64url') })).toString('base64url');
  return `${payload}.${mac(payload, config.secret)}`;
}
export function readSession(request, env = process.env, now = Date.now()) {
  const config = authConfiguration(env);
  const cookies = request.headers.get('cookie') || '';
  const cookie = cookies.split(';').map(value => value.trim()).find(value => value.startsWith(SESSION_COOKIE + '='));
  if (!cookie) return null;
  const token = cookie.slice(SESSION_COOKIE.length + 1);
  if (token.length > 1500) return null;
  const [payload, signature, extra] = token.split('.');
  if (extra || !payload || !constantEqual(signature, mac(payload, config.secret))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    if (Object.keys(session).sort().join(',') !== 'exp,nonce,sub,v' || session.v !== 1 || !constantEqual(session.sub, config.identity)
      || !Number.isInteger(session.exp) || session.exp <= seconds || session.exp > seconds + SESSION_SECONDS || !/^[A-Za-z0-9_-]{24}$/.test(session.nonce)) return null;
    return { email: config.email, csrf: mac(`csrf:${token}`, config.secret), expiresAt: new Date(session.exp * 1000).toISOString() };
  } catch { return null; }
}
export function sessionCookie(token, remove = false) {
  return `${SESSION_COOKIE}=${remove ? '' : token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${remove ? 0 : SESSION_SECONDS}`;
}
export function adminRedirect(location,{status=303,cookie}={}) {
  return new Response(null,{status,headers:{Location:location,'Cache-Control':'private, no-store','Vercel-CDN-Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'same-origin',...(cookie?{'Set-Cookie':cookie}:{})}});
}
export function requireSession(request, env = process.env) {
  const session = readSession(request, env);
  if (!session) throw new AdminError('UNAUTHENTICATED', 401);
  return session;
}
export function requireSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new AdminError('INVALID_ORIGIN', 403);
}
export function requireMutation(request, env = process.env) {
  requireSameOrigin(request);
  const session = requireSession(request, env);
  if (!constantEqual(request.headers.get('x-csrf-token'), session.csrf)) throw new AdminError('INVALID_CSRF', 403);
  return session;
}
export async function readRequestText(request, maximum = 16_384) {
  if (Number(request.headers.get('content-length') || 0) > maximum) throw new AdminError('BODY_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AdminError('INVALID_JSON');
  let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maximum) { await reader.cancel(); throw new AdminError('BODY_TOO_LARGE', 413); } chunks.push(Buffer.from(value)); }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) { if (error instanceof AdminError) throw error; throw new AdminError('INVALID_JSON'); }
}
export async function readJson(request, maximum = 16_384) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new AdminError('JSON_REQUIRED', 415);
  try { const value=JSON.parse(await readRequestText(request,maximum));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value; }
  catch(error){if(error instanceof AdminError)throw error;throw new AdminError('INVALID_JSON');}
}
export async function readLoginInput(request) {
  if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('content-type')||''))return readJson(request);
  const form=new URLSearchParams(await readRequestText(request));
  if([...form.keys()].sort().join(',')!=='email,password')throw new AdminError('INVALID_CREDENTIALS',401);
  return Object.fromEntries(form);
}
