# Newton Prime Web — Implementation Plan

## Scope
Reconstruct the supplied Newton Prime 1.2.26 Flutter app as a Cloudflare Workers web application with an authenticated Stockity adapter. The web app preserves the observed flows—login, real/demo wallet, asset selection, signal parsing, strategy configuration, candle view, bot status, trade history, themes, and notifications—while defaulting to demo mode and requiring an explicit live-mode confirmation.

## Reverse-engineering findings
- Package: `com.koalacreative.koalabot`, version `1.2.26` / code 28.
- Flutter release app; application logic is compiled into `libapp.so`.
- Embedded catalog: 110 assets (97 currencies, 13 crypto; 25 OTC), and 15 themes.
- Observed Stockity hosts: `api.stockity1.id`, `api.stockity1.com`, `stockity1.id`.
- Observed REST paths: `/passport/v2/sign_in`, `/passport/v1/2fa/validate/otp`, `/platform/private/v2/profile`, `/bank/v1/read`, `/bo-assets/v6/assets?locale=id`, `/candles/v1/`, `/bo-deals-history/v3/deals/trade?type=`.
- Observed WebSocket endpoints: `wss://ws.stockity1.id/?v=2&vsn=2.0.0`, `wss://as.stockity1.id/`.
- Strategies and signals found in the binary: Fast, Momentum, Bounce, Flash5st, signal parser, stop-loss, demo switch, bot track, and candle seed logic.

## Architecture
- Cloudflare Worker entrypoint serves static assets and JSON API routes.
- Vite builds the TypeScript frontend into `dist`; Wrangler publishes `dist` via Workers Assets.
- Worker API routes proxy only allowlisted Stockity paths and use a signed/encrypted HttpOnly session cookie; raw passwords are never persisted.
- `SESSION_SECRET` is a Cloudflare secret. Upstream base URL is allowlisted and not user-controlled.
- Frontend uses local state for UI/strategy state and the Worker for authenticated upstream requests.
- Live order submission remains behind two UI gates (live mode + per-order confirmation) and a kill switch; demo is the initial wallet.

## Design system
- Movement: quiet trading cockpit—editorial Swiss grid with soft neo-brutalist controls.
- Principles: calm dense information, unmistakable risk states, progressive disclosure, keyboard-friendly actions.
- Palette: Newton Prime’s extracted `#F5F4F2` / `#2B2A28` / sage `#9FB8A6` with warm secondary `#C8B8A6`; dark mode uses `#1B1A18` / `#E7E2DC`.
- Layout: persistent left rail, asymmetric dashboard canvas, chart/strategy split, bottom activity rail.
- Signature motifs: lime status dot, thin ruled panels, oversized mono numbers.
- Typography: system sans for UI, `ui-monospace` for prices, bids, and timestamps.
- Voice: direct and operational; e.g. “Newton sedang membaca candle.” and “Live terkunci sampai kamu mengaktifkannya.”

## Project structure
- `src/worker.ts`: Worker routes, session sealing, Stockity adapter, demo fallbacks.
- `src/client/`: Vite frontend, state, UI, chart, strategy and signal controls.
- `src/data/`: extracted catalog and themes.
- `public/`: favicon/manifest/route manifest.
- `wrangler.jsonc`: Workers Assets deployment and compatibility settings.

## Constraints
- No Stockity credentials or Cloudflare tokens in source or chat.
- Live API contracts are based on observed APK endpoints and are surfaced as adapter errors rather than silently emulated.
- The website never claims an order succeeded unless Stockity returns a success response.
