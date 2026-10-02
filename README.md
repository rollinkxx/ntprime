# Newton Prime Web

Newton Prime web cockpit reconstructed from the supplied APK. It runs as a Cloudflare Worker with Workers Assets and a small Stockity adapter.

## Important

Demo is the default mode. The Worker never stores the raw Stockity password; it exchanges it over HTTPS for a token and seals that token in an HttpOnly, Secure, SameSite=None cookie. Set the `SESSION_SECRET` Worker secret before enabling login.

The adapter allowlists the Stockity endpoints observed in the APK. The API contract for live order submission is intentionally not guessed: `/api/trade` returns a clear 501 until an official/authorized order contract is configured. This prevents a UI click from silently sending a malformed real-money order.

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
