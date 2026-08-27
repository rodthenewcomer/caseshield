# CaseShield

CaseShield is an acquisition-first validation product for U.S. immigrant visa disruption intelligence. It tests whether applicants value a calm, source-labeled view of interview changes, embassy operations and time-sensitive case risks.

Live site: <https://caseshield-validation.vercel.app/>

## Product boundary

- The public dashboard and signal feed are explicitly illustrative.
- The five-step assessment creates a personalized monitoring plan without requesting a case number.
- No payment is processed. The $29 action measures purchase intent only.
- No email, identity document or sensitive immigration identifier is collected.
- CaseShield is independent, is not affiliated with a U.S. government agency and does not provide individualized legal advice.

## Validation funnel

- `page_view`
- `hero_cta_click`
- `case_check_started`
- `case_step_1` through `case_step_5`
- `case_check_completed`
- `alert_intent`
- `pricing_view`
- `purchase_intent_29`

Events are accepted only through a same-origin, JSON-only serverless endpoint with a narrow allowlist and a 4 KB body limit. Probable case numbers entered as an embassy value are redacted.

## Event persistence

Events are written to Upstash Redis over its REST API, so the runtime stays dependency-free.

Unique-session sets are the funnel's source of truth: a visitor who reloads five times counts once, so each stage reads as people rather than hits. Per stage the store keeps a unique-session set, a raw counter and a 90-day daily set; a capped list of the most recent events supports segment analysis.

Storage is optional by design. With no credentials the endpoint still validates, logs and returns `200` with `stored: false` — analytics can never take the product down.

```sh
vercel integration add upstash      # injects KV_REST_API_URL and KV_REST_API_TOKEN
vercel env add VALIDATION_TOKEN     # openssl rand -hex 32
```

## Validation dashboard

`/validation` reads the funnel: unique sessions, reach, stage-to-stage conversion, the biggest drop-off and the answer mix behind it. The headline metric is **completion → $29 intent** — of the people who finish the assessment, how many ask to pay.

The dashboard is internal. `/api/validation` requires a bearer token compared in constant time and fails closed when `VALIDATION_TOKEN` is unset; the page and route are excluded from `robots.txt`, carry `noindex` and are never linked from the public site.

## Local verification

Requires Node.js 20 or newer.

```sh
npm ci
npm run verify
npx vercel dev
```

`npm run verify` checks the product boundary, CSP and source structure, then runs the endpoint, store and monitoring-plan tests. It needs no network and no credentials.

An optional real-browser pass drives the five-step assessment and fails on any console error. Playwright is deliberately not a project dependency, so CI stays fast:

```sh
npm i --no-save playwright && npx playwright install chromium
npm run smoke                       # add BASE_URL=... to test a deployment
```

## Deployment

The project is configured for Vercel through `vercel.json`. Production deploys are expected to come from the `main` branch after the Quality workflow passes.

See [SECURITY.md](SECURITY.md) for the privacy boundary and vulnerability-reporting path.
