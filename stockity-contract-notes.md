# Stockity contract research notes

Source inspected: https://stockity1.id/main.36ae586140f42fa3.js and dynamically loaded chunks from the same origin on 2026-10-02.

Findings:
- Official headers in bundle: `Authorization-Token`, `Authorization-Version`, `Device-Id`, `Device-Type`.
- Bundle exposes `/bo-deals-history/` as a protected API family, but the exact create-order path/payload was not found in the inspected public chunks.
- Trading bundle includes messages/events such as `dealClosedPublic`, `predictionDealCreateRequested`, `loadOpenUserPositionsRequested`, and `loadPositionOrdersRequested`.
- Current repository intentionally returns HTTP 501 from `/api/trade` because the official order contract is not verified. Do not guess an external order payload.
- User screenshot confirms target asset is `Crypto IDX` under `5ST`, and app account display is Indonesian Rupiah.
