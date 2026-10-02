# Newton Prime Web

Newton Prime web cockpit reconstructed from the supplied APK. It runs as a Cloudflare Worker with Workers Assets and a small Stockity adapter.

## Important

Demo is the default mode. The Worker never stores the raw Stockity password; it exchanges it over HTTPS for a token and seals that token in an HttpOnly, Secure, SameSite=None cookie. Set the `SESSION_SECRET` Worker secret before enabling login. The secret may be any strong random string; the Worker derives a fixed-size AES-256 key from it.

The login adapter follows the sequence statically observed in the supplied Android APK: `POST /passport/v2/sign_in`, then (when `errors[].code` is `2fa_required`) `POST /passport/v1/2fa/validate/otp?locale=id`, then a second `sign_in` carrying `2fa_token` and the challenge cookie. The temporary challenge cookie is encrypted and expires after five minutes. The password is not persisted; it is sent only with HTTPS requests. This is an APK-derived protocol, not a guarantee of a stable or officially supported public API.

The adapter allowlists only the Stockity endpoints observed in the APK and proxies them as GET-only reads; it does not forward Newton Prime's session cookie upstream. The API contract for live order submission is intentionally not guessed: `/api/trade` returns a clear 501 until an official/authorized order contract is configured. This prevents a UI click from silently sending a malformed real-money order.

## Local

```sh
npm install
npm run typecheck
npm run build
npx wrangler dev --local --port 8788
```

## Cloudflare

Create a Worker named `newton-prime`, upload/connect this repository, set the build command to `npm run build`, and publish `dist` through Workers Assets. In Worker Settings → Variables and Secrets, add a randomly generated `SESSION_SECRET` as an encrypted secret. Keep `STOCKITY_API_BASE` as `https://api.stockity1.id` unless your authorized Stockity environment documents another host.

Never commit passwords, tokens, cookies, or a real account identifier.
