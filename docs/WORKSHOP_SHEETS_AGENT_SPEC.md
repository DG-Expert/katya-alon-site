# Workshop Sheets Admin: Agent Implementation Specification

Status: **design only**. Nothing here is implemented or verified. Each stage ends with an acceptance gate; do not mark a stage done without evidence (command output). Companion user doc: `docs/WORKSHOP_SHEETS_ADMIN_HE.md`.

## 0. Hard constraints (apply to every stage)

- Never read, write, or transmit the `Registrations` tab or any registrant data.
- Never store or print PAT / Cloudflare / HMAC / Turnstile / `GAS_URL` secrets in the Sheet, repo, logs, or PR text. Do not guess secret values; ask the owner.
- Do not touch the live GAS web app deployment or the live Worker without explicit owner approval per action. The dynamic-event GAS patch was saved in live GAS but **not deployed**; the local event feature (`scripts/sync-event.mjs`, `scripts/make-gas-patch.mjs`, `worker/src/event.generated.js`) is **uncommitted and undeployed**. Treat both as pending, not live.
- No git add/commit/push or deploy unless the task explicitly says so.
- Never claim a button or menu works without running it. Report `done / blocker / decision_required / tests_failed / review_required` explicitly.
- Preserve HE/EN/RU locales and `registration.consent_version` safety.

## 1. Current-state facts (verified in repo)

- `content/workshop.yaml`: top-level blocks `layout`, `sections`, `event` (plain `key: value`, strictly parsed by `scripts/sync-event.mjs`), `registration` (flow-mapping incl. `consent_version`, `endpoint`, `turnstile_*`), `meta`, `accessibility`, `nav`, `layout_labels`, `hero`, `content_1/2/3`, `power_image`, `ctas`, `pricing`, `instructor`, `form`, `footer`, `system`. Locale leaves are `{he, en, ru}` flow maps; some leaves use tokens `{event.date}`, `{event.date_short}`, `{event.date_long}`, `{event.sessions}`, `{event.hours}`, `{price}`, `{currency}`, `{vat}`, `{count}`, `{total}`.
- `worker/src/validate.js`: single `EVENT.workshopId` compared with `body.workshopId`; `CONSENT_VERSIONS` from `wrangler.toml` `[vars]`.
- `gas/Code.gs`: dedup keyed on `workshopId` + hashed email/mobile; `EVENT:<workshopId>` Script Property stores event per id.
- No `.github/`, no `package.json`. Tests: `node --test test/*.test.mjs` (Node 24, no deps). Add no npm dependencies unless the owner approves (YAML AST needs one; see 4.2).
- Free-text coupling that the Sheet cannot guard automatically: `pricing.deadline` / `after_deadline` contain literal dates; `content_3.intro`, `pricing.intro/includes` contain number words; calendar link and email subject are not YAML-driven. The early-bird date is owner-confirmed: 10.11.2026 inclusive, full price from 11.11.2026.

## 2. Architecture (recommended)

```
Sheet tab "ניהול סדנאות"  --(bound Apps Script Publish.gs, custom menu)-->
   canonical JSON -> gzip -> base64 + sha256 + base blob SHA
   --(workflow_dispatch, fine-grained PAT Actions:write)--> GitHub Action
   Action: schema validate -> safe YAML AST update -> sync-event -> node tests -> branch + PR
   Human reviewer merges -> Pages deploy; Worker/GAS deploy via gated workflows
```

Trust model: sheet editors == trusted. Bound-script editors can read Script Properties, so the PAT is privileged; the PR review is the real gate. Stronger option (phase 3, optional): a separate standalone Apps Script / Worker "admin proxy" holding the PAT, with the Sheet calling it with a signed request; then sheet editors cannot read the PAT.

Rejected: Sheet pushing YAML text or code directly to the repo; PAT in cells; Sheet touching Cloudflare/GAS deployment.

## 3. Sheet contract (already created by assistant)

Tab `ניהול סדנאות`, sheetId 622176661. Rows 1-3 title/warnings. Row 4 header, fixed A:J: A category, B YAML path, C label, D scalar-or-Hebrew, E English, F Russian, G type, H required, I state, J help. Rows 5-56 scaffold; locale cells blank tagged `יש לייבא`.

Rules: Publish.gs reads only this tab by sheetId (not by name), range A4:J. Header row must exactly match; abort otherwise. Row order is irrelevant; key is column B. Duplicate or unknown B → error. Protect columns A-C, G-H and row 1-4 with sheet protection (editors: owner only).

`G` type enum: `string_l10n` (D/E/F all required), `scalar` (D only), `int`, `money`, `date`, `bool`, `asset`, `enum`, `list_l10n` (array item paths `a.b[2]`; adding/removing items is **out of scope phase 1**: fixed length).

## 4. Stages

### Stage A – Baseline and safety (no feature code)
1. Run `git status`, `node --test test/*.test.mjs`, `node scripts/sync-event.mjs --check`; record output. If red, `blocker`.
2. Write allowlist file `content/sheet-schema.json` (new, additive): per YAML path → type, required, locales, constraints (max length, regex, enum, range), cross-field rules. Generate the initial list from the 52 scaffold rows' column B, then diff against YAML leaves; report paths in sheet but not YAML, and the reverse.
3. Explicitly **exclude** from allowlist: `registration.*` (endpoint, turnstile_*, enabled, consent_version), `meta.*`? (include only title/description), `system.*`, all URLs, `event.timezone`. `consent_version` is read-only display.
Gate: schema file validates; leaf diff report reviewed by owner (`decision_required` for each gap).

### Stage B – Exporter (YAML -> Sheet rows), local only
1. `scripts/export-sheet-rows.mjs`: parse YAML with a real parser (see 4.2) and output rows `[path, he, en, ru, type]` for each allowlisted path. Pure function plus `--json` output; **no Sheet access, no network**.
2. Tokens preserved verbatim; unit test: export then import is identity (round-trip) on current YAML.
3. Missing localized rows (currently `יש לייבא`) are produced from this export; Publish.gs's Import consumes the exporter's JSON (pasted/served via a repo-hosted raw file or a PR-time artifact; decide with owner: `decision_required`).
Gate: round-trip test passes; no row lost; counts reported against 52.

### Stage C – Importer/applier (Sheet JSON -> YAML), local only
4.2 Parser choice: YAML edits must use an AST that preserves comments and flow style (e.g. `yaml` package `parseDocument`). That is a new dependency ⇒ `decision_required`. Without it, fall back to *targeted replacement of known leaf locations* only if a golden-file test proves byte-identical output for unchanged input. Never build YAML by string concatenation of user text; always escape via the library.
1. `scripts/apply-sheet.mjs <payload.json>`: verify sha256, decode, check base blob SHA against the checked-out file, validate against `sheet-schema.json`, apply only allowlisted paths, write YAML, run `sync-event.mjs`.
2. Validation rules (fail closed, list all errors): all three locales non-empty for `string_l10n`; max lengths; no HTML/script/`javascript:`/`data:`; token whitelist per path (unknown `{x}` rejected; required tokens preserved); `asset` must match `^\./assets/images/[A-Za-z0-9._-]+\.(webp|png|jpg)$` and exist; `sections` keys subset of known; `layout` ∈ {conversion, story, program}; dates real, second > first, if `session_count` ≥ 2 then second date or an explicit null with a warning; money: ints ≥ 0, `current_price ≤ original_price`, `per_session_price × session_count == current_price` (warn if not), `pricing.session_count == event.session_count`; `workshop_id` regex `^[A-Za-z0-9._-]{1,64}$`.
3. Cross-text warnings (not errors): any `dd.mm.yyyy`/`d month` date in `pricing.deadline|after_deadline` that does not equal the structured deadline date; number words ("שני/ארבע", "two/four", "две/четыре") inconsistent with `session_count`/`total_hours`.
Gate: tests for each rule (positive + negative), golden unchanged-diff test, idempotent re-run yields empty diff. `node --test test/*.test.mjs` green.

### Stage D – Workshop id and zero-outage rollover
1. Worker: accept a **list** of workshop ids (current + previous) from generated event data (`event.generated.js` gains `previousWorkshopIds`, sourced from `event.previous_workshop_ids`, not from the sheet unless owner approves). `validate.js` checks membership; signed payload uses the id the client sent. Keep fail-closed on empty.
2. GAS: ensure `EVENT:<id>` exists for both ids before the Worker accepts the new id (deploy order GAS → Worker is already documented in `WORKSHOPS_EDITING.md`). Dedup remains per id, so a new id never collides with old registrations.
3. Tests: old id accepted during overlap, unknown id rejected, empty list rejects all, GAS handles both.
Gate: worker/gas tests green. **No deploy by the agent.** Provide owner a deploy checklist.

### Stage E – GitHub Action (files only; not enabled until owner approves)
`.github/workflows/sheet-edit.yml`, `workflow_dispatch` with input `payload` (gzip+base64, size cap ≈ 60 KB; check GitHub's input limit before relying on it – if exceeded use a dedicated branch file upload instead: `decision_required`).
- Permissions: `contents: write`, `pull-requests: write` only. Job runs `apply-sheet.mjs`, `node --test`, then creates `sheet/<timestamp>` branch and opens PR with a generated diff summary and warnings. Never commits to `main`.
- Never echo payload or secrets; payload logged only as sha256.
- Concurrency group so one open sheet PR at a time.
- Path-limited commit: fail if `git diff --name-only` ⊄ {`content/workshop.yaml`, `worker/src/event.generated.js`}.
- Separate deploy workflows (`pages` on main with path filter; `worker-deploy` and `gas` only via GitHub Environment with required reviewer and scoped secrets). Do not create or request secrets; document the names the owner must add.
Gate: dry-run via `act` or a fork/test repo; negative test: payload with a non-allowlisted path is rejected with no PR.

### Stage F – Publish.gs (bound script; do not install or run on production sheet without approval)
Menu `סדנאות`: Import YAML, Validate, Submit PR, Check Status, Restore.
- Reads only sheet 622176661; builds canonical JSON (sorted keys, NFC, `\n` newlines); client-side validation mirrors schema subset (the Action is authoritative).
- Writes status/errors to column I only; protected columns never written.
- `Submit`: sha256 + gzip (`Utilities.gzip`) + base64, `UrlFetchApp` to the dispatch endpoint with `Authorization` from `PropertiesService.getScriptProperties().getProperty('GH_DISPATCH_TOKEN')`; Show only HTTP status, never the token. Use `getRange().getValues()` (no `getDataRange()` on other tabs). OAuth scopes in `appsscript.json` limited to `spreadsheets.currentonly` and `script.external_request` – verify no broader scope appears.
- Optimistic concurrency: Import records base blob SHA of `content/workshop.yaml` in a hidden Developer Metadata or Script Property; Submit sends it; Action rejects on mismatch ("sheet is stale, re-import").
- `Check Status` polls workflow runs/PRs via the GitHub API (read-only).
- `Restore` re-imports from `main` (never from a stale PR).
- Placeholders: if any row state is `יש לייבא`, Validate and Submit refuse.
Gate: unit tests for pure helpers run in Node (extract helpers so they are testable); manual script run only by owner on a **copy** of the workbook first. Report as `review_required`.

### Stage G – Docs and handoff
Update `docs/WORKSHOP_SHEETS_ADMIN_HE.md` statuses only for items actually verified. Add change log. Provide owner with: list of new files, the exact secret names to add (no values), and the deploy order.

## 5. Phases for coupled content (honest scope)

| Phase | Delivers |
|---|---|
| 1 | Copy (titles, paragraphs, CTAs, prices, assets, layout) via PR; event structured fields; validation + warnings for coupled text |
| 2 | Structured deadline date + generated deadline sentences via tokens (`{pricing.deadline_date}`), number words generated from counts per locale; consent version change workflow (Worker var + YAML + legal sign-off) |
| 3 | Email subject/body and calendar link driven from event data (GAS patch); optional admin proxy for PAT isolation |

Phase 1 must not be described to the user as "fully automatic".

## 6. Consent safety

`registration.consent_version` and `CONSENT_VERSIONS` in `wrangler.toml` must match. Action fails if YAML `consent_version` ∉ `wrangler.toml` list, or if `form.consent`/`form.privacy_notice` text changed without `consent_version` change (compare against base; warn/fail by owner policy: `decision_required`). Old versions remain in the Worker list during overlap.

## 7. Definition of done (accepted)

1. Stages A-E pass with evidence pasted (commands + outputs); F is delivered as reviewed code, not installed.
2. `node --test test/*.test.mjs` and `node scripts/sync-event.mjs --check` green on the final tree.
3. Round-trip test: export → import produces no diff on current YAML.
4. Negative tests prove: non-allowlisted path, missing locale, bad asset path, price/date violations, stale base SHA, and tampered sha256 are all rejected.
5. No secret value appears in any file (`grep` for tokens/`ghp_`/`github_pat_`/long hex).
6. `Registrations` untouched; no network calls to production in tests.
7. Deploy checklist and rollback written; owner explicitly confirmed `Publish.gs` run on a workbook copy.
8. Final report states one of `done` (awaiting acceptance), `blocker`, `decision_required`, `tests_failed`, `review_required`.

## 8. Rollback

- Sheet: Restore from `main`, or version history; PR not merged: close it.
- Merged: `git revert` via PR → Pages redeploys; Worker/GAS: redeploy previous commit through the gated workflow; GAS: previous deployment version.
- Remove access: delete the PAT in GitHub, delete `GH_DISPATCH_TOKEN` property, remove the menu by deleting `Publish.gs`.

## 9. Open decisions for the owner

1. Add a YAML AST dependency (`yaml`)? 2. Payload transport (dispatch input vs file upload). 3. Admin proxy now or later. 4. Policy for consent text change detection. 5. How previous workshop ids are declared. 6. Who is the PR reviewer/merger.
