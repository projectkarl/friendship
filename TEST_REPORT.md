# NEULI Live 2.5D v0.3 — Test Report

Date: 2026-10-02

## Passed

- `node --check public/app.js`
- `node --check server.mjs`
- `GET /health` → 200, version `0.3.0`
- `GET /` → 200
- Layer PNG assets exist and are non-empty
- `POST /api/chat` → JSON reply
- Neutral reconstruction check: base + eye + mouth layers reconstruct the source appearance without visible identity swap
- Responsive CSS includes desktop, <=860px mobile/tablet, <=420px compact, <=360px narrow-phone rules

## Runtime architecture

- One WebGL canvas
- High-density base mesh draw pass
- Independent facial layer draw passes
- Dedicated closed-eye cross-fade instead of eye-crushing blink
- Separate mouth deformation for visemes
- Separate front-hair motion pass

## Environment limitation

A Chromium screenshot smoke test could not be completed in this container because the headless Chromium graphics process hangs under the available EGL/ANGLE software-rendering environment. HTTP, JS syntax, asset, and API checks pass; final visual WebGL validation should be done in Safari/Chrome on the target phone or desktop.
