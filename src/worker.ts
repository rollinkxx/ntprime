type AssetFetcher = { fetch(request: Request): Promise<Response> };
export interface Env {
  ASSETS: AssetFetcher;
  SESSION_SECRET?: string;
  STOCKITY_API_BASE?: string;
}

type Session = {
  token?: string;
  userId?: string;
  deviceId?: string;
  apiBase?: string;
  createdAt: number;
  liveEnabled: boolean;
  pending2fa?: boolean;
  email?: string;
  sessionCookie?: string;
};

type LoginBody = { email?: unknown; password?: unknown };
type OtpBody = { password?: unknown; otp?: unknown };
type StockityResponse = {
  authtoken?: unknown;
  user_id?: unknown;
  message?: unknown;
  error?: unknown;
  errors?: Array<{ code?: unknown; message?: unknown; context?: { message?: unknown } }>;
  data?: Record<string, unknown>;
  profile?: unknown;
  user?: unknown;
  [key: string]: unknown;
};

const PRIMARY_API = 'https://api.stockity1.id';
const SECONDARY_API = 'https://api.stockity1.com';
const DEFAULT_STOCKITY_USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; NewtonPrime) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 NewtonPrimeWebView';
const ALLOWED_READ_PATHS = [
  '/platform/private/v2/profile',
  '/bank/v1/read',
  '/bo-assets/v6/assets',
  '/candles/v1/',
  '/bo-deals-history/v3/deals/trade',
];
const DEMO_ASSETS = [
  { ric: 'CRYPTO_IDX', name: 'Crypto IDX', typeName: '5ST' },
  { ric: 'EUR/USD', name: 'EUR/USD', typeName: 'Currencies' },
  { ric: 'GBP/USD-DXF', name: 'GBP/USD', typeName: 'Currencies' },
  { ric: 'USD/JPY-DXF', name: 'USD/JPY', typeName: 'Currencies' },
  { ric: 'BTCUSD-OTC', name: 'Bitcoin (OTC)', typeName: 'Crypto' },
  { ric: 'ETHUSD-OTC', name: 'Ethereum (OTC)', typeName: 'Crypto' },
  { ric: 'XAU/USD', name: 'Gold / USD', typeName: 'Commodities' },
];
const DEMO_CANDLES = (n = 72) => Array.from({ length: n }, (_, i) => {
  const t = Date.now() - (n - i) * 60_000;
  const base = 100 + Math.sin(i / 5) * 1.8 + i * 0.03;
  const open = base;
  const close = base + Math.sin(i * 1.7) * 0.9;
  return { time: t, open, high: Math.max(open, close) + 0.45, low: Math.min(open, close) - 0.45, close };
});

type Candle = { time: number; open: number; high: number; low: number; close: number };
function normalizeCandle(value: unknown): Candle | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const number = (...keys: string[]) => {
    for (const key of keys) {
      const candidate = item[key];
      const parsed = typeof candidate === 'number' ? candidate : typeof candidate === 'string' ? Number(candidate) : NaN;
      if (Number.isFinite(parsed)) return parsed;
    }
    return NaN;
  };
  const time = number('time', 'timestamp', 'ts', 't', 'start', 'from');
  const open = number('open', 'o'); const high = number('high', 'h');
  const low = number('low', 'l'); const close = number('close', 'c');
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return { time: time < 10_000_000_000 ? time * 1000 : time, open, high, low, close };
}
function findCandles(value: unknown): Candle[] {
  if (Array.isArray(value)) {
    const direct = value.map(normalizeCandle).filter((item): item is Candle => Boolean(item));
    if (direct.length) return direct;
    for (const nested of value) { const found = findCandles(nested); if (found.length) return found; }
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = findCandles(nested); if (found.length) return found;
    }
  }
  return [];
}

const enc = (v: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(v))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const dec = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

// Cloudflare secrets can be arbitrary strings (often 64-char hex). Derive a
// fixed-size AES-256 key instead of passing the raw secret to importKey.
async function key(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function seal(session: Session, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await key(secret),
    new TextEncoder().encode(JSON.stringify(session)),
  );
  return `${enc(iv.buffer)}.${enc(ciphertext)}`;
}
async function open(value: string | undefined, secret: string): Promise<Session | null> {
  try {
    if (!value) return null;
    const [iv, ciphertext] = value.split('.');
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: dec(iv) }, await key(secret), dec(ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext)) as Session;
  } catch {
    return null;
  }
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const sessionCookie = (value: string, maxAge = 86_400) =>
  `np_session=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
const clearSessionCookie = () => sessionCookie('', 0);

function cookieValue(request: Request, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))?.[1];
}
function getApiBases(env: Env) {
  const configured = env.STOCKITY_API_BASE?.trim();
  return configured ? [configured.replace(/\/+$/, '')] : [PRIMARY_API, SECONDARY_API];
}
function stockityUserAgent(request: Request) {
  return request.headers.get('user-agent') || DEFAULT_STOCKITY_USER_AGENT;
}
function readString(value: unknown) {
  return typeof value === 'string' && value.length ? value : typeof value === 'number' ? String(value) : undefined;
}
function upstreamError(data: StockityResponse, fallback: string) {
  const firstError = data?.errors?.[0];
  return readString(data?.message)
    || readString(data?.error)
    || readString(firstError?.context?.message)
    || readString(firstError?.message)
    || fallback;
}
function isTwoFactorRequired(data: StockityResponse) {
  return data?.errors?.some(error => error?.code === '2fa_required') ?? false;
}
function extractSessionCookie(headers: Headers) {
  // The APK keeps the first cookie pair from Set-Cookie and sends it back as Cookie.
  const setCookie = headers.get('set-cookie');
  return setCookie?.split(';', 1)[0]?.trim() || undefined;
}
async function responseJson(response: Response): Promise<StockityResponse> {
  return await response.json().catch(() => ({})) as StockityResponse;
}
function responsePayload(data: StockityResponse): Record<string, unknown> {
  const nested = data.data;
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : data;
}
function validEmail(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 320;
}
function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024;
}

async function stockityLogin(
  base: string,
  deviceId: string,
  email: string,
  password: string,
  userAgent: string,
  options: { sessionCookie?: string; twoFaToken?: string } = {},
) {
  const headers = new Headers({
    'content-type': 'application/json',
    'Device-Id': deviceId,
    'Device-Type': 'web',
    'User-Agent': userAgent,
  });
  if (options.sessionCookie) headers.set('cookie', options.sessionCookie);

  const body: Record<string, string> = { email, password };
  if (options.twoFaToken) body['2fa_token'] = options.twoFaToken;
  return fetch(new URL('/passport/v2/sign_in', base), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function upstreamRead(request: Request, env: Env, session: Session, path: string, search: string) {
  const base = session.apiBase || getApiBases(env)[0];
  const target = new URL(path + search, base);
  const headers = new Headers({ accept: 'application/json' });
  if (session.token) {
    headers.set('Authorization-Token', session.token);
    headers.set('authorization', `Bearer ${session.token}`);
  }
  if (session.deviceId) headers.set('Device-Id', session.deviceId);
  headers.set('Device-Type', 'web');
  headers.set('Authorization-Version', '2');

  // This adapter only proxies allowlisted GET endpoints. In particular it never
  // forwards Newton Prime's encrypted np_session cookie to Stockity.
  return fetch(target, { method: 'GET', headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const secret = env.SESSION_SECRET;

    if (url.pathname === '/api/health') return json({ ok: true, app: 'newton-prime', mode: 'demo-first', authAdapter: 'stockity-v2-data-envelope' });

    if (url.pathname === '/api/session' && request.method === 'GET') {
      const session = secret ? await open(cookieValue(request, 'np_session'), secret) : null;
      const authenticated = Boolean(session?.token && !session.pending2fa);
      return json({ authenticated, twoFactorRequired: Boolean(session?.pending2fa), liveEnabled: authenticated && Boolean(session?.liveEnabled) });
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      if (!secret) return json({ error: 'SESSION_SECRET belum dikonfigurasi di Cloudflare Worker.' }, 503);
      const body = await request.json().catch(() => ({})) as LoginBody;
      if (!validEmail(body.email) || !validPassword(body.password)) {
        return json({ error: 'Email dan password wajib diisi.' }, 400);
      }

      const email = body.email.trim();
      const deviceId = crypto.randomUUID().replaceAll('-', '');
      const userAgent = stockityUserAgent(request);
      const bases = getApiBases(env);
      let lastError: unknown;

      for (let index = 0; index < bases.length; index++) {
        const base = bases[index];
        let response: Response;
        try {
          response = await stockityLogin(base, deviceId, email, body.password, userAgent);
        } catch (error) {
          lastError = error;
          continue;
        }

        // The APK tries configured API hosts; only retry a transient upstream
        // failure, never a credential/OTP response.
        if (response.status >= 500 && index < bases.length - 1) continue;
        const data = await responseJson(response);

        if (response.status === 422 && isTwoFactorRequired(data)) {
          const challengeCookie = extractSessionCookie(response.headers);
          if (!challengeCookie) return json({ error: 'Stockity meminta OTP tetapi sesi verifikasi tidak tersedia.' }, 502);
          const pending: Session = {
            deviceId,
            apiBase: base,
            email,
            sessionCookie: challengeCookie,
            pending2fa: true,
            createdAt: Date.now(),
            liveEnabled: false,
          };
          const sealed = await seal(pending, secret);
          return json({ ok: true, twoFactorRequired: true }, 202, { 'set-cookie': sessionCookie(sealed, 300) });
        }

        if (!response.ok) {
          return json({ error: upstreamError(data, 'Login Stockity gagal.') }, response.status);
        }

        const payload = responsePayload(data);
        const token = readString(response.headers.get('Authorization-Token'))
          || readString(response.headers.get('authorization-token'))
          || readString(payload.authtoken);
        const userId = readString(payload.user_id);
        if (!token || !userId) {
          return json({ error: 'Stockity merespons tetapi data sesi tidak lengkap atau tidak dikenali. Coba lagi.' }, 502);
        }

        const session: Session = { token, userId, deviceId, apiBase: base, createdAt: Date.now(), liveEnabled: false };
        const sealed = await seal(session, secret);
        return json({ ok: true, profile: payload.user || payload.profile || null, liveEnabled: false }, 200, { 'set-cookie': sessionCookie(sealed) });
      }

      return json({ error: lastError instanceof Error ? `Tidak dapat terhubung ke Stockity: ${lastError.message}` : 'Tidak dapat terhubung ke host API Stockity.' }, 502);
    }

    if (url.pathname === '/api/auth/2fa' && request.method === 'POST') {
      if (!secret) return json({ error: 'SESSION_SECRET belum dikonfigurasi.' }, 503);
      const pending = await open(cookieValue(request, 'np_session'), secret);
      if (!pending?.pending2fa || !pending.deviceId || !pending.apiBase || !pending.sessionCookie || !pending.email) {
        return json({ error: 'Sesi verifikasi OTP tidak ditemukan. Silakan mulai login kembali.' }, 401, { 'set-cookie': clearSessionCookie() });
      }
      if (Date.now() - pending.createdAt > 5 * 60_000) {
        return json({ error: 'Sesi OTP kedaluwarsa. Silakan mulai login kembali.' }, 401, { 'set-cookie': clearSessionCookie() });
      }

      const body = await request.json().catch(() => ({})) as OtpBody;
      if (!validPassword(body.password) || typeof body.otp !== 'string' || !body.otp.trim()) {
        return json({ error: 'Password dan kode OTP wajib diisi.' }, 400);
      }

      const userAgent = stockityUserAgent(request);
      const headers = new Headers({
        'content-type': 'application/json',
        'Device-Id': pending.deviceId,
        'Device-Type': 'web',
        'User-Agent': userAgent,
        cookie: pending.sessionCookie,
      });
      let otpResponse: Response;
      try {
        otpResponse = await fetch(new URL('/passport/v1/2fa/validate/otp?locale=id', pending.apiBase), {
          method: 'POST',
          headers,
          body: JSON.stringify({ otp: body.otp.trim() }),
        });
      } catch {
        return json({ error: 'Tidak dapat menghubungi layanan verifikasi OTP Stockity.' }, 502);
      }

      const otpData = await responseJson(otpResponse);
      if (!otpResponse.ok) {
        return json({ error: upstreamError(otpData, 'Kode OTP salah atau sudah kedaluwarsa. Coba lagi.') }, 400);
      }
      const otpPayload = responsePayload(otpData);
      const twoFaToken = readString(otpPayload['2fa_token']);
      if (!twoFaToken) {
        return json({ error: 'Token verifikasi OTP tidak ditemukan dalam respons Stockity.' }, 502);
      }

      // The APK's flow is three calls: sign_in → validate/otp → sign_in again
      // with both the 2fa_token and challenge cookie. The password is not stored
      // in the encrypted challenge cookie; it is forwarded only for this request.
      const finalCookie = extractSessionCookie(otpResponse.headers) || pending.sessionCookie;
      let loginResponse: Response;
      try {
        loginResponse = await stockityLogin(pending.apiBase, pending.deviceId, pending.email, body.password, userAgent, {
          sessionCookie: finalCookie,
          twoFaToken,
        });
      } catch {
        return json({ error: 'Tidak dapat menyelesaikan login Stockity setelah verifikasi OTP.' }, 502);
      }

      const loginData = await responseJson(loginResponse);
      if (!loginResponse.ok) {
        if (loginResponse.status === 422 && isTwoFactorRequired(loginData)) {
          const nextCookie = extractSessionCookie(loginResponse.headers) || finalCookie;
          const nextPending: Session = { ...pending, sessionCookie: nextCookie, createdAt: Date.now() };
          const sealed = await seal(nextPending, secret);
          return json({ ok: true, twoFactorRequired: true }, 202, { 'set-cookie': sessionCookie(sealed, 300) });
        }
        return json({ error: upstreamError(loginData, 'Login Stockity gagal setelah verifikasi OTP.') }, loginResponse.status);
      }

      const loginPayload = responsePayload(loginData);
      const token = readString(loginResponse.headers.get('Authorization-Token'))
        || readString(loginResponse.headers.get('authorization-token'))
        || readString(loginPayload.authtoken);
      const userId = readString(loginPayload.user_id);
      if (!token || !userId) {
        return json({ error: 'Stockity merespons tetapi data sesi tidak lengkap atau tidak dikenali. Coba lagi.' }, 502);
      }

      const session: Session = {
        token,
        userId,
        deviceId: pending.deviceId,
        apiBase: pending.apiBase,
        createdAt: Date.now(),
        liveEnabled: false,
      };
      const sealed = await seal(session, secret);
      return json({ ok: true, profile: loginPayload.user || loginPayload.profile || null, liveEnabled: false }, 200, { 'set-cookie': sessionCookie(sealed) });
    }

    if (url.pathname === '/api/auth/logout') {
      return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
    }

    if (url.pathname === '/api/live/enable' && request.method === 'POST') {
      if (!secret) return json({ error: 'SESSION_SECRET belum dikonfigurasi.' }, 503);
      const session = await open(cookieValue(request, 'np_session'), secret);
      if (!session?.token) return json({ error: 'Sesi tidak ditemukan.' }, 401);
      // Fail closed: a live flag is not a trading connection. The verified APK
      // contract still requires a Phoenix/WebSocket handshake, join acknowledgement,
      // heartbeat, reconnect handling, and settlement reconciliation.
      return json({
        error: 'Live trading belum tersedia: adapter WebSocket/order resmi belum terverifikasi dan tidak ada transaksi yang dikirim.',
        liveEnabled: false,
      }, 501);
    }

    if (url.pathname === '/api/data/assets') {
      if (!secret) return json({ assets: DEMO_ASSETS, source: 'demo', authenticated: false });
      const session = await open(cookieValue(request, 'np_session'), secret);
      if (!session?.token) return json({ assets: DEMO_ASSETS, source: 'demo', authenticated: false });
      const response = await upstreamRead(request, env, session, '/bo-assets/v6/assets', '');
      const data = await response.json().catch(() => ({}));
      return response.ok ? json({ assets: data, source: 'stockity', authenticated: true }) : json({ assets: DEMO_ASSETS, source: 'demo-fallback', authenticated: true });
    }
    if (url.pathname === '/api/data/candles') {
      if (!secret) return json({ candles: DEMO_CANDLES(), source: 'demo', authenticated: false });
      const session = await open(cookieValue(request, 'np_session'), secret);
      if (!session?.token) return json({ candles: DEMO_CANDLES(), source: 'demo', authenticated: false });
      const asset = url.searchParams.get('asset') || 'Crypto IDX';
      const end = Math.floor(Date.now() / 1000); const start = end - 72 * 60;
      const query = new URLSearchParams({ asset, ric: asset, period: '60', interval: '60', start: String(start), end: String(end) });
      const response = await upstreamRead(request, env, session, '/candles/v1/', `?${query}`);
      const data = await response.json().catch(() => ({}));
      const candles = response.ok ? findCandles(data).slice(-200) : [];
      if (candles.length >= 5) return json({ candles, source: 'stockity', authenticated: true, asset });
      return json({ candles: DEMO_CANDLES(), source: 'demo-fallback', authenticated: true, asset, upstreamStatus: response.status }, 200);
    }

    if (url.pathname.startsWith('/api/stockity/')) {
      if (!secret) return json({ error: 'SESSION_SECRET belum dikonfigurasi.' }, 503);
      if (request.method !== 'GET') return json({ error: 'Proxy Stockity hanya mengizinkan endpoint GET read-only.' }, 405, { allow: 'GET' });
      const session = await open(cookieValue(request, 'np_session'), secret);
      if (!session?.token) return json({ error: 'Login Stockity diperlukan.' }, 401);
      const path = url.pathname.slice('/api/stockity'.length);
      const allowed = ALLOWED_READ_PATHS.some(candidate => candidate.endsWith('/') ? path.startsWith(candidate) : path === candidate);
      if (!allowed) return json({ error: 'Endpoint tidak diizinkan.' }, 403);
      const response = await upstreamRead(request, env, session, path, url.search);
      return new Response(response.body, {
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
      });
    }

    if (url.pathname === '/api/trade' && request.method === 'POST') {
      if (!secret) return json({ error: 'SESSION_SECRET belum dikonfigurasi.' }, 503);
      const session = await open(cookieValue(request, 'np_session'), secret);
      if (!session?.token) return json({ error: 'Login Stockity diperlukan.' }, 401);
      return json({
        error: 'Order broker belum tersedia: kontrak resmi, WebSocket Phoenix, acknowledgement, dan settlement belum terverifikasi. Tidak ada order yang dikirim.',
        submitted: false,
        account: 'broker-session-authenticated',
      }, 501);
    }

    const asset = await env.ASSETS.fetch(request);
    return asset.status === 404 ? env.ASSETS.fetch(new Request(new URL('/', request.url), request)) : asset;
  },
};
