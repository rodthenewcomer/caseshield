# CaseShield

CaseShield is an acquisition-first validation product for U.S. immigrant visa disruption intelligence. It tests whether applicants value a calm, source-labeled view of interview changes, embassy operations and time-sensitive case risks.

Live site: <https://caseshield-validation.vercel.app/>

## Product boundary

- The public dashboard and signal feed are explicitly illustrative.
- The five-step assessment creates a personalized monitoring plan without requesting a case number.
- No payment is processed. The $29 action measures purchase intent only.
- No email, identity document or sensitive immigration identifier is collected.
- CaseShield is independent, is not affiliated with a U.S. government agency and does not provide individualized legal advice.

Public policy pages live at [`/privacy.html`](privacy.html) and [`/terms.html`](terms.html).

## Validation funnel

The funnel is deliberately not one flat sequence. Treating an optional action as a mandatory stage divides a conversion by the wrong denominator, which is how a validation dashboard quietly lies to its owner.

**Core funnel** — the mandatory path:

`page_view` → `case_check_started` → `case_step_1` … `case_step_5` → `case_check_completed`

**Diagnostic events** — real, but optional:

`hero_cta_click`, `alert_intent`, `pricing_view`, `result_offer_click`, `purchase_intent_29`

`hero_cta_click` is intent to begin; `case_check_started` fires only on the first genuine interaction with a question. Keeping them apart stops two metrics from measuring the same thing.

## The decision metric

**Qualified WTP** = |completed ∩ purchase_intent_29| ÷ |completed|

It is an exact Redis set intersection (`SINTERCARD`), never a ratio of two independent totals. A visitor who scrolls straight to pricing and clicks $29 without running a case check is real interest — reported as `unqualified_intents` — but is excluded from the numerator.

The same intersection is applied inside each campaign cohort, so an ad is judged on the visitors it actually sent.

## Acquisition attribution

First touch is captured once and never overwritten: an ad that brought someone in keeps the credit when they return directly.

Captured: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, and the referrer **host**. Never captured: the full referrer URL or its query string, click identifiers, or anything identifying a person.

Cohort and answer registries are capped, so an ad platform emitting arbitrary `utm_term` values cannot explode the Redis key space.

Paid-search message match maps a small trusted enum of `utm_content` values (`cancelled`, `rescheduled`, `no_date`, `nvc_delay`) to prewritten hero copy. Arbitrary UTM text is never rendered on the page.

Events are accepted only through a same-origin, JSON-only serverless endpoint with strict allowlists and a 4 KB body limit. Probable case numbers are redacted, including out of campaign parameters.

## Event persistence

Events are written to Upstash Redis over its REST API, so the runtime stays dependency-free.

Unique-session sets are the source of truth: a visitor who reloads five times counts once, so every stage reads as people rather than hits. Per stage the store keeps a unique-session set, a raw counter and a 90-day daily set; per-cohort and per-answer sets back the acquisition and problem-mix tables.

Storage is optional by design. With no credentials the endpoint still validates, logs and returns `200` with `stored: false` — analytics can never take the product down.

```sh
vercel integration add upstash      # injects KV_REST_API_URL and KV_REST_API_TOKEN
vercel env add VALIDATION_TOKEN     # openssl rand -hex 32
```

## Environment isolation

Preview traffic reaching the production dataset would corrupt the numbers that
decide whether to fund this company, so isolation is enforced in two layers.

**Separate stores.** Production and Preview should hold different Upstash
credentials. Development deliberately has none: without them the endpoint still
answers `200` with `stored:false`, so local work cannot touch a real dataset.

**Namespaced keys.** Every key carries its environment:

```
cs:v1:prod:uniq:case_check_completed
cs:v1:preview:uniq:case_check_completed
```

The namespace comes from `VERCEL_ENV` through a frozen enum
(`production→prod`, `preview→preview`, `development→dev`, anything else→`dev`).
`VERCEL_ENV` is never interpolated into a key, so an unexpected value cannot
become key material. This holds even if someone later points Preview at the
production database by mistake.

`ANALYTICS_STORE_ENV` optionally declares which store the credentials belong
to. When it disagrees with the actual environment, `/validation` shows a
configuration warning rather than silently trusting the setup. The dashboard
also states the environment and a short store fingerprint, so two environments
sharing one database is visible at a glance.

### Cleaning up test data

Never issue a database-wide flush: with a shared database it destroys the
production dataset. Use the namespace-scoped script, which refuses any key
outside the target namespace:

```sh
npm run flush -- preview          # dry run, lists what would go
npm run flush -- preview --apply  # deletes only cs:v1:preview:*
```

### Excluding your own visits

Loading the live site to check on it would otherwise register as an ordinary
session and dilute every stage denominator. Visit `/?cs_internal=1` once to
stop being counted, `/?cs_internal=0` to undo.

## Validation dashboard

`/validation` reports Qualified WTP, the core funnel with its biggest drop-off, optional actions measured against completers, an acquisition cohort table and the problem mix — all as unique sessions. Sample size is labelled honestly: `directional` under 20 completions, `early` under 100, `decision` at 100 or more.

The dashboard is internal. `/api/validation` requires a bearer token compared in constant time and fails closed when `VALIDATION_TOKEN` is unset; the page and route are excluded from `robots.txt`, carry `noindex` and are never linked from the public site.

## Local verification

Requires Node.js 20 or newer.

```sh
npm ci
npm run verify
npx vercel dev
```

`npm run verify` checks the product boundary, CSP and source structure, then runs the endpoint, store, funnel, attribution and monitoring-plan tests. It needs no network and no credentials.

An optional real-browser pass drives the product for real. Playwright is deliberately not a project dependency, so CI stays fast:

```sh
npm i --no-save playwright && npx playwright install chromium
npm run smoke                        # local static server
BASE_URL=https://… npm run smoke     # a real deployment
SHOTS=work/after npm run smoke       # also capture responsive screenshots
node scripts/og-image.mjs            # regenerate the social card
```

The smoke run covers three scenarios: a paid click through the whole journey, a completion that skips alert intent, and a $29 click with no completion at all — the case that must stay out of Qualified WTP.

## Deployment

The project is configured for Vercel through `vercel.json`. Production deploys come from the `main` branch after the Quality workflow passes.

Preview and Production analytics are namespaced separately, so preview testing cannot enter the production dataset. They currently share one Upstash database (the free plan allows a single database), which is safe for correctness but means a database-wide flush would destroy both — always use `npm run flush -- <namespace>`. Provisioning a second database and repointing the Preview credentials is a configuration change only; no code change is needed.

See [SECURITY.md](SECURITY.md) for the privacy boundary and vulnerability-reporting path.
