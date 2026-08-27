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

## Local verification

Requires Node.js 20 or newer.

```sh
npm ci
npm run verify
npx vercel dev
```

`npm run verify` checks the product boundary, CSP and source structure, then runs the endpoint and monitoring-plan tests.

## Deployment

The project is configured for Vercel through `vercel.json`. Production deploys are expected to come from the `main` branch after the Quality workflow passes.

See [SECURITY.md](SECURITY.md) for the privacy boundary and vulnerability-reporting path.
