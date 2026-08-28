# Security and privacy

CaseShield is an acquisition-validation product, not a case-management system. It must not collect A-numbers, passport numbers, USCIS receipt numbers, NVC case numbers, Social Security numbers, immigration documents or payment-card data.

The interactive assessment requests only visa category, embassy or city, disruption type, process timing and product need. A probable case number entered in the embassy field is rejected in the browser and redacted by the event endpoint.

## What is stored

Validation events are persisted to Upstash Redis to make the funnel measurable. A stored event contains only the event name, a timestamp, a random anonymous session id, the allowlisted answer fields above, and first-touch campaign attribution.

Attribution is limited to `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` and the referrer **host**. The full referrer URL and its query string are discarded, because a search-result address can carry the visitor's own search terms. Click identifiers such as `gclid` are not accepted.

No IP address is stored. The client address is used transiently to derive a per-minute rate-limit counter, which expires within two minutes and is never written to an event record or used for attribution.

Session ids are generated in the browser, carry no identity, and exist to distinguish one visitor from five page reloads.

Retention: aggregate unique-session totals persist for the life of the validation test, per-day breakdowns expire after 90 days, and a rolling sample of the most recent 500 events is kept for diagnostics.

## Endpoint controls

- POST only, `application/json` only, 4 KB body limit
- Same-origin enforcement; cross-site callers rejected via `Sec-Fetch-Site`
- Strict event-name and field allowlists; unknown fields are dropped
- Campaign values normalized to bounded slugs, so a crafted UTM cannot forge
  extra cohort columns or explode the key space
- Case-number redaction applied to campaign parameters as well as the embassy
  field, since a crafted ad URL is a real vector
- Per-IP rate limiting that fails open so analytics never breaks the product

## Environment isolation

Analytics keys are namespaced by environment (`cs:v1:prod:`, `cs:v1:preview:`,
`cs:v1:dev:`) from a frozen enum, so preview or local traffic can never enter
the production dataset. Development carries no store credentials at all.

The internal dashboard states which environment it is reading and warns when
the configured store does not match it. A short, non-reversible fingerprint of
the store host is shown so a shared database is visible; the URL and token are
never exposed.

## Internal dashboard

`/validation` and `/api/validation` expose business metrics and are not public. Access requires a bearer token compared in constant time, the route fails closed when `VALIDATION_TOKEN` is unset, and both are excluded from `robots.txt` and marked `noindex`.

Rotate `VALIDATION_TOKEN` with `vercel env rm` followed by `vercel env add` if it is ever shared or pasted somewhere it should not have been.

## Reporting

Please report a vulnerability through a private GitHub security advisory for this repository. Do not include real immigration identifiers or documents in a report.
