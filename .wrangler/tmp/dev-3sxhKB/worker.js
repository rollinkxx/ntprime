var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-SF9x7Z/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/worker.ts
var ALLOWED = /* @__PURE__ */ new Set(["/platform/private/v2/profile", "/bank/v1/read", "/bo-assets/v6/assets", "/candles/v1/", "/bo-deals-history/v3/deals/trade"]);
var DEMO_ASSETS = [
  { ric: "EUR/USD", name: "EUR/USD", typeName: "Currencies" },
  { ric: "GBP/USD-DXF", name: "GBP/USD", typeName: "Currencies" },
  { ric: "USD/JPY-DXF", name: "USD/JPY", typeName: "Currencies" },
  { ric: "BTCUSD-OTC", name: "Bitcoin (OTC)", typeName: "Crypto" },
  { ric: "ETHUSD-OTC", name: "Ethereum (OTC)", typeName: "Crypto" },
  { ric: "XAU/USD", name: "Gold / USD", typeName: "Commodities" }
];
var DEMO_CANDLES = /* @__PURE__ */ __name((n = 72) => Array.from({ length: n }, (_, i) => {
  const t = Date.now() - (n - i) * 6e4;
  const base = 1.081 + Math.sin(i / 5) * 3e-3 + i * 5e-5;
  const open2 = base;
  const close = base + Math.sin(i * 1.7) * 15e-4;
  return { time: t, open: open2, high: Math.max(open2, close) + 8e-4, low: Math.min(open2, close) - 8e-4, close };
}), "DEMO_CANDLES");
var enc = /* @__PURE__ */ __name((v) => btoa(String.fromCharCode(...new Uint8Array(v))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""), "enc");
var dec = /* @__PURE__ */ __name((s) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0)), "dec");
async function key(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
__name(key, "key");
async function seal(session, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(JSON.stringify(session)));
  return `${enc(iv.buffer)}.${enc(c)}`;
}
__name(seal, "seal");
async function open(value, secret) {
  try {
    if (!value)
      return null;
    const [iv, c] = value.split(".");
    const p = await crypto.subtle.decrypt({ name: "AES-GCM", iv: dec(iv) }, await key(secret), dec(c));
    return JSON.parse(new TextDecoder().decode(p));
  } catch {
    return null;
  }
}
__name(open, "open");
var json = /* @__PURE__ */ __name((data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } }), "json");
var cookie = /* @__PURE__ */ __name((v, maxAge = 86400) => `np_session=${v}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`, "cookie");
async function upstream(request, env, session, path, search = "") {
  const base = env.STOCKITY_API_BASE || "https://api.stockity1.id";
  const target = new URL(path + search, base);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.set("accept", "application/json");
  if (session.token)
    headers.set("authorization", `Bearer ${session.token}`);
  return fetch(target, { method: request.method, headers, body: request.method === "GET" ? void 0 : await request.text() });
}
__name(upstream, "upstream");
var worker_default = { async fetch(request, env) {
  const url = new URL(request.url);
  const secret = env.SESSION_SECRET;
  if (url.pathname === "/api/health")
    return json({ ok: true, app: "newton-prime", mode: "demo-first" });
  if (url.pathname === "/api/session" && request.method === "GET") {
    const s = secret ? await open(request.headers.get("cookie")?.match(/np_session=([^;]+)/)?.[1], secret) : null;
    return json({ authenticated: !!s, liveEnabled: !!s?.liveEnabled });
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    if (!secret)
      return json({ error: "SESSION_SECRET belum dikonfigurasi di Cloudflare Worker." }, 503);
    const body = await request.json().catch(() => ({}));
    if (!body.email || !body.password)
      return json({ error: "Email dan password wajib diisi." }, 400);
    const base = env.STOCKITY_API_BASE || "https://api.stockity1.id";
    const r = await fetch(new URL("/passport/v2/sign_in", base), { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email: body.email, password: body.password }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      return json({ error: data?.message || "Login Stockity gagal.", upstreamStatus: r.status }, r.status);
    const token = data?.token || data?.auth_token || data?.access_token || data?.data?.token;
    if (!token)
      return json({ error: "Login berhasil tetapi token tidak ditemukan dari respons Stockity.", upstream: data }, 502);
    const s = await seal({ token, createdAt: Date.now(), liveEnabled: false }, secret);
    return json({ ok: true, profile: data?.user || data?.profile || null, liveEnabled: false }, 200, { "set-cookie": cookie(s) });
  }
  if (url.pathname === "/api/auth/logout")
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  if (url.pathname === "/api/live/enable" && request.method === "POST") {
    if (!secret)
      return json({ error: "SESSION_SECRET belum dikonfigurasi." }, 503);
    const raw = request.headers.get("cookie")?.match(/np_session=([^;]+)/)?.[1];
    const s = await open(raw, secret);
    if (!s)
      return json({ error: "Sesi tidak ditemukan." }, 401);
    const next = await seal({ ...s, liveEnabled: true }, secret);
    return json({ ok: true, liveEnabled: true }, 200, { "set-cookie": cookie(next) });
  }
  if (url.pathname === "/api/data/assets")
    return json({ assets: DEMO_ASSETS, source: "demo" });
  if (url.pathname === "/api/data/candles")
    return json({ candles: DEMO_CANDLES(), source: "demo" });
  if (url.pathname.startsWith("/api/stockity/")) {
    if (!secret)
      return json({ error: "SESSION_SECRET belum dikonfigurasi." }, 503);
    const raw = request.headers.get("cookie")?.match(/np_session=([^;]+)/)?.[1];
    const s = await open(raw, secret);
    if (!s)
      return json({ error: "Login Stockity diperlukan." }, 401);
    const path = url.pathname.slice("/api/stockity".length);
    if (![...ALLOWED].some((p) => path.startsWith(p)))
      return json({ error: "Endpoint tidak diizinkan." }, 403);
    const r = await upstream(request, env, s, path, url.search);
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" } });
  }
  if (url.pathname === "/api/trade" && request.method === "POST") {
    if (!secret)
      return json({ error: "SESSION_SECRET belum dikonfigurasi." }, 503);
    const raw = request.headers.get("cookie")?.match(/np_session=([^;]+)/)?.[1];
    const s = await open(raw, secret);
    if (!s)
      return json({ error: "Login Stockity diperlukan." }, 401);
    if (!s.liveEnabled)
      return json({ error: "Live mode masih terkunci. Aktifkan live mode terlebih dahulu." }, 423);
    return json({ error: "Live order adapter membutuhkan kontrak order resmi dari Stockity; tidak ada order yang dikirim." }, 501);
  }
  const asset = await env.ASSETS.fetch(request);
  return asset.status === 404 ? env.ASSETS.fetch(new Request(new URL("/", request.url), request)) : asset;
} };

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-SF9x7Z/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-SF9x7Z/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
