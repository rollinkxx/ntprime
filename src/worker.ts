type AssetFetcher = { fetch(request: Request): Promise<Response> };
export interface Env {
  ASSETS: AssetFetcher;
  SESSION_SECRET?: string;
  STOCKITY_API_BASE?: string;
}

type Session = { token: string; apiToken?: string; createdAt: number; liveEnabled: boolean };
const ALLOWED = new Set(['/platform/private/v2/profile', '/bank/v1/read', '/bo-assets/v6/assets', '/candles/v1/', '/bo-deals-history/v3/deals/trade']);
const DEMO_ASSETS = [
  { ric: 'EUR/USD', name: 'EUR/USD', typeName: 'Currencies' }, { ric: 'GBP/USD-DXF', name: 'GBP/USD', typeName: 'Currencies' },
  { ric: 'USD/JPY-DXF', name: 'USD/JPY', typeName: 'Currencies' }, { ric: 'BTCUSD-OTC', name: 'Bitcoin (OTC)', typeName: 'Crypto' },
  { ric: 'ETHUSD-OTC', name: 'Ethereum (OTC)', typeName: 'Crypto' }, { ric: 'XAU/USD', name: 'Gold / USD', typeName: 'Commodities' }
];
const DEMO_CANDLES = (n = 72) => Array.from({ length: n }, (_, i) => {
  const t = Date.now() - (n - i) * 60_000; const base = 1.081 + Math.sin(i / 5) * .003 + i * .00005; const open = base;
  const close = base + Math.sin(i * 1.7) * .0015; return { time: t, open, high: Math.max(open, close) + .0008, low: Math.min(open, close) - .0008, close };
});

const enc = (v: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(v))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const dec = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
// Cloudflare secrets are arbitrary strings (often 64-char hex). Derive a
// fixed-size AES-256 key instead of passing the raw secret to importKey.
async function key(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function seal(session: Session, secret: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), new TextEncoder().encode(JSON.stringify(session))); return `${enc(iv.buffer)}.${enc(c)}`; }
async function open(value: string | undefined, secret: string): Promise<Session | null> { try { if (!value) return null; const [iv, c] = value.split('.'); const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: dec(iv) }, await key(secret), dec(c)); return JSON.parse(new TextDecoder().decode(p)); } catch { return null; } }
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const cookie = (v: string, maxAge = 86400) => `np_session=${v}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
const upstreamError = (data: any, fallback: string) => data?.message || data?.error || data?.errors?.[0]?.context?.message || data?.errors?.[0]?.message || fallback;

async function upstream(request: Request, env: Env, session: Session, path: string, search = '') {
  const base = env.STOCKITY_API_BASE || 'https://api.stockity1.id';
  const target = new URL(path + search, base);
  const headers = new Headers(request.headers); headers.delete('host'); headers.set('accept', 'application/json');
  if (session.token) headers.set('authorization', `Bearer ${session.token}`);
  return fetch(target, { method: request.method, headers, body: request.method === 'GET' ? undefined : await request.text() });
}

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url); const secret = env.SESSION_SECRET;
  if (url.pathname === '/api/health') return json({ ok: true, app: 'newton-prime', mode: 'demo-first' });
  if (url.pathname === '/api/session' && request.method === 'GET') {
    const s = secret ? await open(request.headers.get('cookie')?.match(/np_session=([^;]+)/)?.[1], secret) : null;
    return json({ authenticated: !!s, liveEnabled: !!s?.liveEnabled });
  }
  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    if (!secret) return json({ error: 'SESSION_SECRET belum dikonfigurasi di Cloudflare Worker.' }, 503);
    const body = await request.json().catch(() => ({})) as { email?: string; password?: string };
    if (!body.email || !body.password) return json({ error: 'Email dan password wajib diisi.' }, 400);
    const base = env.STOCKITY_API_BASE || 'https://api.stockity1.id';
    const deviceId = crypto.randomUUID().replaceAll('-', '');
    const r = await fetch(new URL('/passport/v2/sign_in', base), {
      method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'application/json',
        'user-agent': request.headers.get('user-agent') || 'Mozilla/5.0 (compatible; NewtonPrime/1.0)',
        origin: new URL(base).origin,
        'Device-Id': deviceId, 'Device-Type': 'web', 'Authorization-Version': '2'
      },
      body: JSON.stringify({ email: body.email, password: body.password, device: { id: deviceId, type: 'web' } })
    });
    const data = await r.json().catch(() => ({})) as any;
    if (!r.ok) return json({ error: upstreamError(data, 'Login Stockity gagal.'), upstreamStatus: r.status }, r.status);
    const token = data?.token || data?.auth_token || data?.access_token || data?.data?.token;
    if (!token) return json({ error: 'Login berhasil tetapi token tidak ditemukan dari respons Stockity.', upstream: data }, 502);
    const s = await seal({ token, createdAt: Date.now(), liveEnabled: false }, secret);
    return json({ ok: true, profile: data?.user || data?.profile || null, liveEnabled: false }, 200, { 'set-cookie': cookie(s) });
  }
  if (url.pathname === '/api/auth/logout') return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  if (url.pathname === '/api/live/enable' && request.method === 'POST') {
    if (!secret) return json({ error: 'SESSION_SECRET belum dikonfigurasi.' }, 503);
    const raw = request.headers.get('cookie')?.match(/np_session=([^;]+)/)?.[1]; const s = await open(raw, secret); if (!s) return json({ error: 'Sesi tidak ditemukan.' }, 401);
    const next = await seal({ ...s, liveEnabled: true }, secret); return json({ ok: true, liveEnabled: true }, 200, { 'set-cookie': cookie(next) });
  }
  if (url.pathname === '/api/data/assets') return json({ assets: DEMO_ASSETS, source: 'demo' });
  if (url.pathname === '/api/data/candles') return json({ candles: DEMO_CANDLES(), source: 'demo' });
  if (url.pathname.startsWith('/api/stockity/')) {
    if (!secret) return json({ error: 'SESSION_SECRET belum dikonfigurasi.' }, 503);
    const raw = request.headers.get('cookie')?.match(/np_session=([^;]+)/)?.[1]; const s = await open(raw, secret); if (!s) return json({ error: 'Login Stockity diperlukan.' }, 401);
    const path = url.pathname.slice('/api/stockity'.length); if (![...ALLOWED].some(p => path.startsWith(p))) return json({ error: 'Endpoint tidak diizinkan.' }, 403);
    const r = await upstream(request, env, s, path, url.search); return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
  }
  if (url.pathname === '/api/trade' && request.method === 'POST') {
    if (!secret) return json({ error: 'SESSION_SECRET belum dikonfigurasi.' }, 503);
    const raw = request.headers.get('cookie')?.match(/np_session=([^;]+)/)?.[1]; const s = await open(raw, secret,); if (!s) return json({ error: 'Login Stockity diperlukan.' }, 401);
    if (!s.liveEnabled) return json({ error: 'Live mode masih terkunci. Aktifkan live mode terlebih dahulu.' }, 423);
    return json({ error: 'Live order adapter membutuhkan kontrak order resmi dari Stockity; tidak ada order yang dikirim.' }, 501);
  }
  const asset = await env.ASSETS.fetch(request); return asset.status === 404 ? env.ASSETS.fetch(new Request(new URL('/', request.url), request)) : asset;
} };
