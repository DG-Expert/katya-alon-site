# Workshops page editing guide

The workshops page is driven by one manual content file: `content/workshop.yaml`. Do not edit `workshops.html` to change a workshop, layout, section, CTA label, image, or form message.

## Choose a layout

Set `layout` to exactly one of these unquoted values:

- `conversion` — dominant hero and detail rail, benefit cards, supporting image, repeated CTA emphasis.
- `story` — centered editorial hero, spacious staggered narrative blocks, wide image, minimal FAQ rows.
- `program` — structured detail panel, numbered agenda/timeline, process-led image and practical-information grid.

Example:

```yaml
layout: conversion
```

The URL can preview another layout without editing or saving the YAML:

- `/workshops.html?lang=he&layout=conversion`
- `/workshops.html?lang=en&layout=story`
- `/workshops.html?lang=ru&layout=program`

On the private development preview, use `https://dev-server.tail6972d4.ts.net:8445/workshops.html?lang=he&layout=conversion` (substitute `story` or `program`). The `layout` query parameter is only a temporary preview override; it never changes `content/workshop.yaml`.

## Show or hide optional sections

These are the only section switches:

```yaml
sections:
  content_1: true
  content_2: true
  power_image: true
  content_3: true
  pricing: true
  instructor: true
```

Use the real YAML booleans `true` or `false`, without quotes. A `false` section is omitted entirely and leaves no empty spacing. `content_1: false` also hides the first CTA; `content_2: false` hides the second CTA. The final registration demo form is always present and has no toggle.

`pricing` and `instructor` are optional reusable blocks. The pricing values are deliberately numeric under `pricing.original_price`, `pricing.current_price`, and `pricing.per_session_price`; keep them in sync (currently 4000, 3000, and 1500 × 2). Edit the localized price labels, VAT text, deadline, and post-deadline copy in the same `pricing` object.

Important: the supplied source conflicts between an 8 November and 10 November early-bird deadline. The preview intentionally shows **10.11.2026** consistently. The owner must decide the public deadline before publication; promotional price dates are manual content and must be updated or removed when the deadline passes.

## Images

Put uploaded workshop images inside the existing local `assets/` tree, preferably:

```text
assets/images/workshop-name.webp
```

Then update:

```yaml
power_image:
  src: "./assets/images/workshop-name.webp"
```

Only relative paths beginning with `./assets/` are accepted. Remote URLs, `data:` URLs, `javascript:` URLs, backslash paths, and paths escaping `assets/` are rejected. There is no automatic fallback image: if `src` is missing or invalid, the entire image slot is hidden. Always edit all three translations under `power_image.alt`; edit `power_image.caption` or leave its translated strings empty if no caption is wanted.

## Exact YAML field map

Every translated leaf below is an object with exactly `he`, `en`, and `ru` string values.

| Path | Purpose |
| --- | --- |
| `layout` | Permanent template: `conversion`, `story`, or `program` |
| `sections.content_1` | Show the opening narrative and CTA 1 |
| `sections.content_2` | Show cards/story chapters/program timeline and CTA 2 |
| `sections.power_image` | Show the power image when its path is valid |
| `sections.content_3` | Show supporting questions/information |
| `sections.pricing` / `sections.instructor` | Show the optional price / instructor blocks |
| `meta.title.{he,en,ru}` | Browser and Open Graph title |
| `meta.description.{he,en,ru}` | Search/Open Graph description |
| `accessibility.skip_to_content.{he,en,ru}` | Keyboard skip-link label |
| `nav.brand_alt.{he,en,ru}` | Logo alternative text |
| `nav.navigation_label.{he,en,ru}` | Main-nav accessible label |
| `nav.language_label.{he,en,ru}` | Language-switch accessible label |
| `nav.open_menu.{he,en,ru}` | Closed mobile-menu button label |
| `nav.close_menu.{he,en,ru}` | Open mobile-menu button label |
| `nav.home.{he,en,ru}` | Logo/home-link accessible label |
| `nav.about/services/process/contact/workshops.{he,en,ru}` | Navigation labels |
| `layout_labels.conversion/story/program.{he,en,ru}` | Hero preview label for each layout |
| `hero.eyebrow/title/subtitle/description.{he,en,ru}` | Main workshop hero copy |
| `hero.details_kicker/details_heading.{he,en,ru}` | Hero detail-panel headings |
| `hero.details[]` | Editable detail rows |
| `hero.details[].label.{he,en,ru}` | Detail label |
| `hero.details[].value.{he,en,ru}` | Detail value; keep placeholders honest until approved |
| `content_1.kicker/title.{he,en,ru}` | Opening section headings |
| `content_1.paragraphs[].{he,en,ru}` | Opening narrative paragraphs |
| `content_2.kicker/title/intro.{he,en,ru}` | Benefits/story/program section headings |
| `content_2.items[]` | Reused as cards, chapters, or agenda steps |
| `content_2.items[].title/text.{he,en,ru}` | One item’s title and description |
| `power_image.src` | One validated local image path |
| `power_image.alt/caption.{he,en,ru}` | Image alternative text and optional caption |
| `ctas.after_content_1.{he,en,ru}` | CTA 1 label |
| `ctas.after_power_image.{he,en,ru}` | CTA 2 label |
| `content_3.kicker/title/intro.{he,en,ru}` | Supporting/FAQ section headings |
| `content_3.items[]` | Supporting question rows |
| `content_3.items[].question/answer.{he,en,ru}` | One question and answer |
| `pricing.original_price/current_price/per_session_price` | Numeric price inputs; no currency symbols in these values |
| `pricing.currency/vat_text/...{he,en,ru}` | Localized price labels, deadline, and CTA |
| `instructor.kicker/title/role/paragraphs.{he,en,ru}` | Instructor copy |
| `instructor.image.src`, `instructor.image.alt.{he,en,ru}` | Local local portrait and alt text |
| `form.kicker/title/intro.{he,en,ru}` | Final form-section copy |
| `form.demo_notice.{he,en,ru}` | Prominent not-live disclosure |
| `form.privacy_note.{he,en,ru}` | Browser-validation/no-real-PII note |
| `form.submit_label.{he,en,ru}` | Permanently disabled sign-up button label |
| `form.fields.<field>.label/placeholder/help.{he,en,ru}` | Copy for each fixed form field |
| `form.fields.<field>.errors.<error>.{he,en,ru}` | Inline validation messages |
| `form.status.fix_errors/no_registration.{he,en,ru}` | Form-wide non-submission messages |
| `footer.rights.{he,en,ru}` | Footer rights label |
| `system.content_error.{he,en,ru}` | YAML/content load error message |

The four fixed field keys are `full_name`, `mobile`, `email`, and `expertise`. Their order, constraints, and names are part of the page contract; edit their translated copy, not their keys or HTML structure.

## YAML syntax essentials

- Indent with spaces only; two spaces per level is recommended. Never use tabs.
- Keep `he`, `en`, and `ru` at the same indentation under every translated value.
- List entries begin with `-` at the list’s indentation level.
- Quote text containing `: `, `#`, leading punctuation, or other YAML-significant characters.
- Keep `true` and `false` unquoted. Quoted values such as `"false"` are strings and the page will reject them.
- Keep `layout` unquoted and lowercase.
- Content is rendered as text with DOM text nodes. HTML entered in YAML is not interpreted as markup.
- After editing, load all three languages and check the browser console for a YAML parse or schema error.

## Registration status and security boundary

Registration is not live. The page has no backend, collection purpose, retention policy, CAPTCHA provider, bot protection, database, or secrets. The sign-up button is always disabled and must remain disabled until a secure backend, server-side validation, CAPTCHA/anti-bot decision, privacy terms, and data-handling design are approved. Client-side field validation remains available for usability only; the page does not fetch, log, persist, or transmit field values. Even an implicit form-submit attempt is prevented and produces an explicit “no registration was created” message.

Do not change the disclosure or imply that anti-bot/security infrastructure is enabled. Connecting Firebase, reCAPTCHA, Turnstile, email, a CRM, or any other submission service requires a separate product and security decision, server-side validation, privacy terms, and an approved data-handling design.

## Workshop event details (single source) and deploy

Technical event details live in ONE place: the `event:` block at the top of `content/workshop.yaml` (`workshop_id`, `timezone`, `first_session_date` as quoted `"YYYY-MM-DD"`, `second_session_date` as `null` until known, `session_count`, `total_hours`). Plain `key: value` lines only.

- **Site**: strings may use `{event.date}` (16.11.2026), `{event.date_short}` (en), `{event.date_long}` (16 November 2026), `{event.sessions}`, `{event.hours}`. They are used for the "at a glance" list, the first-session answer and the form title.
- **Worker + emails**: the Worker no longer has `WORKSHOP_ID`; it takes the workshop id and event details from `worker/src/event.generated.js`, generated from the YAML, and adds them to the HMAC-signed payload. Registration emails (he/en/ru) are built from that data; the browser cannot supply event details.
- **After editing the YAML** run (from the repo root): `node scripts/sync-event.mjs && (cd worker && npx wrangler deploy)`. `node scripts/sync-event.mjs --check` fails if the generated file is stale (also covered by `node --test test/*.test.mjs`). Changing `workshop_id` starts a new dedup namespace by design.
- **Still manual text** (does not follow `event`): number words and plural forms such as "two sessions / four hours" in prose, pricing dates (`pricing.deadline`, `after_deadline`, 10.11.2026), the "second-session date will be provided" sentence on the page, and the Google Calendar link (`EVENT_START_ISO`, `EVENT_END_ISO`, `EVENT_TIMEZONE` Script Properties).
- **Apps Script**: `gas/Code.gs` is the source; `node scripts/make-gas-patch.mjs` writes an ASCII-only block (default `/tmp/gas-event-patch.gs`) to paste at the END of an existing cloud `Code.gs`. Deploy order: Apps Script first (new version of the web app), then the Worker. The GAS change accepts both old 7-key and new payloads.
