# Registration setup (ACTIVE in production since 2026-10-23)

Architecture (approved): **browser → Cloudflare Worker (CORS, validation, rate limit, Turnstile Siteverify) → Google Apps Script (HMAC-verified, server-to-server) → private Google Sheet + mail**.

The form is live: `SECURE_REGISTRATION_BACKEND_APPROVED = true`, `registration.enabled: true`. To switch OFF, revert these two flags (originally `false` and the form stays OFF until every step below is done: in `js/workshops.js`, `registration.enabled: false`, empty `endpoint` and `turnstile_site_key` in `content/workshop.yaml`. Nothing here creates accounts or resources; the owner performs each step in their own Google and Cloudflare accounts. The repo is public (GitHub Pages root), so `worker/` and `gas/` sources are visible; they contain **no** secrets, Sheet IDs or endpoints.

Files: `worker/wrangler.toml`, `worker/src/index.js`, `worker/src/validate.js`, `gas/Code.gs`, `gas/appsscript.json`, `test/*.test.mjs` (run: `node --test test/*.test.mjs`, Node 24; run `npm ci` first for the pinned js-yaml build dependency).

## Owner decisions still required

1. Final privacy notice, consent wording, **retention/deletion period** and lawful handling of contact data. The visible privacy text is a placeholder. Once approved, choose a `consent_version` string (e.g. `2026-11-v1`).
2. Exact first-session start/end time and timezone (`Asia/Jerusalem`), second-session date, and the Zoom link. **None are known; none are invented.** Until start, end and timezone are configured, the participant email has no calendar link and no Zoom link.
3. Who may access the Sheet (owner/editors only; never public).
4. Approve the participant email wording (it states: details received, not payment or seat confirmation).

## Setup sequence

### 1. Google account (Katya's) – Sheet and Apps Script
1. Create a **private** Google Sheet (empty). Copy its ID from the URL (`/d/<ID>/edit`). The script creates the `Registrations` tab and headers on first write.
2. In that Sheet: Extensions → Apps Script. Replace the files with `gas/Code.gs`; enable "Show appsscript.json" in Project Settings and paste `gas/appsscript.json` (V8).
3. Project Settings → Script Properties, add:
   | Property | Value |
   | --- | --- |
   | `SHEET_ID` | the Sheet ID |
   | `HMAC_SECRET` | long random string (e.g. `openssl rand -hex 32`); same value goes to the Worker |
   | `DEDUPE_SALT` | another long random string (never change it later or duplicate detection resets) |
   | `OWNER_EMAIL` | `katya.shivuk@gmail.com` (owner notification target; configured server-side only) |
   | `EVENT_START_ISO`, `EVENT_END_ISO` | optional, local time e.g. `2026-11-16T18:00:00` – only when real times are known |
   | `EVENT_TIMEZONE` | optional, e.g. `Asia/Jerusalem`. The calendar link appears only when all three are valid and end > start |
4. Run `installTriggers` once from the editor (authorize Sheets + mail scopes). It creates a 15-minute trigger for `retryPendingMails`.
5. Deploy → New deployment → Web app: **Execute as: Me**, **Who has access: Anyone**. "Anyone" is required because the Worker calls it without Google login; security comes from the **mandatory HMAC signature** (SHA-256, 300 s window) – unsigned or direct calls write nothing. Copy the `/exec` URL (this is `GAS_URL`, a secret).
6. After any code change, create a **new deployment version** (the `/exec` URL stays the same when you edit the existing deployment).

Mail quota: `MailApp` allows about 100 recipients/day on consumer Gmail (more on Workspace). Each registration sends 2 mails (owner + participant). Over quota, mails remain `PENDING` and are retried by the trigger (max 5 attempts, then `FAILED`; check the Sheet).

### 2. Cloudflare account – Turnstile
1. Dashboard → Turnstile → Add widget. Allowed hostnames: `dg-expert.github.io` (and `dev-server.tail6972d4.ts.net` for the private preview). Mode: Managed.
2. The **site key** is public → later put it in `registration.turnstile_site_key`. The **secret key** is private → Worker secret `TURNSTILE_SECRET`.
3. The Worker accepts a token only if Siteverify returns `success`, hostname in `TURNSTILE_HOSTNAMES` and action `workshop_register`. Tokens are single-use and expire after 300 s; the form resets the widget after every attempt.

### 3. Cloudflare account – Worker
From `worker/` with Wrangler installed by the owner (`npx wrangler login`):
```
npx wrangler secret put GAS_URL           # the Apps Script /exec URL
npx wrangler secret put GAS_HMAC_SECRET   # same as Script Property HMAC_SECRET
npx wrangler secret put TURNSTILE_SECRET  # Turnstile secret key
```
Set `CONSENT_VERSIONS` in `wrangler.toml` `[vars]` to the approved consent version(s) (empty = every request rejected). Review `ALLOWED_ORIGINS` (exact origins; no wildcard) and `TURNSTILE_HOSTNAMES`. The rate-limit binding `REGISTRATION_LIMITER` (namespace_id `1001`, 5 requests / 60 s per IP) is declared in `wrangler.toml`; it is approximate and per Cloudflare location, so the Apps Script duplicate check and mail quota are the backstop. Then `npx wrangler deploy`. The endpoint is `https://<worker>.<subdomain>.workers.dev/api/register` (or a custom route). The Worker fails closed (503) if the limiter, a secret, or an `https` GAS URL is missing.

### 4. Activate the site (separate, approved step)
After an E2E test with the owner's own test data: in `content/workshop.yaml` set `enabled: true`, `endpoint`, `turnstile_site_key`, and `consent_version` (= an entry of `CONSENT_VERSIONS`); also set `registration.timeout_ms` to about `28000` (the Worker waits up to 25 s for Apps Script, which sends mail before replying; the default 10000 can show a false timeout although the row was saved, and a retry is safe because of the idempotency key), then flip `SECURE_REGISTRATION_BACKEND_APPROVED` to `true` in `js/workshops.js` and update the privacy/consent wording. The Turnstile script loads only when all of these are present.

## Behavior reference

- **CORS**: the Worker answers `OPTIONS` and `POST /api/register` only for exact allowed origins (`Vary: Origin`, `Content-Type` header only). Apps Script cannot do CORS preflight, which is why the browser never calls it; Origin is not authentication, so Turnstile, rate limit and HMAC remain.
- **Server validation** (browser checks are convenience): name = Unicode letters/separators, no digits; mobile = 8–15 ASCII digits; email ≤ 254; expertise 2–160, no numerals; lang `he|en|ru`; exact `workshopId`; `consent: true`; approved `consentVersion`; empty honeypot `website`; UUID idempotency key; Turnstile token ≤ 2048; body ≤ 8192 bytes; no unknown fields.
- **Responses**: 200 created/replay, 409 duplicate or changed retry, 422 invalid, 429 rate limited, 403 Turnstile/origin, 413/415 request shape, 502/503 upstream, 504 timeout. No PII or secrets are logged or returned.
- **Idempotency & duplicates**: key = browser UUID (kept across network retries, regenerated after success or editing). Same key + same data → replay, no second row/mail; same key + different data → conflict. Same workshop + same email or mobile (salted hashes) → duplicate.
- **Sheet columns** (`Registrations`, plain-text format, leading `= + - @` escaped with `'`): `registeredAt, registrationId, workshopId, full_name, mobile, email, expertise, lang, consentVersion, status, requestId, fingerprint, emailHash, mobileHash, ownerMail, registrantMail, mailAttempts, mailUpdatedAt`. Mail columns hold `PENDING | SENDING:<ms> | SENT | FAILED`. A mail stuck in `SENDING` for 10 min is retried (a crash in that window could rarely double-send).
- **Mail**: owner gets the private Sheet link + registration ID (no participant data); the participant gets the recorded fields, 16 November 2026, two sessions / four hours, second date TBA, and never the Sheet link.
- **Privacy**: participant data lives in the Sheet and mailboxes. Define retention/deletion and access; never put PII in browser storage or analytics.

## Not verified without accounts

Real Turnstile, Cloudflare rate limiting, Apps Script deployment/redirects, MailApp delivery and Sheet formatting are covered only by mocked automated tests. Run an owner-approved end-to-end test before activation.

> Update: `WORKSHOP_ID` is no longer a Worker variable; the workshop id and event details come from `content/workshop.yaml` (`event:`) via `node scripts/sync-event.mjs` and are signed into the payload. See WORKSHOPS_EDITING.md, "Workshop event details".
