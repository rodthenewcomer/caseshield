# Security and privacy

CaseShield is an acquisition-validation product, not a case-management system. It must not collect A-numbers, passport numbers, USCIS receipt numbers, NVC case numbers, Social Security numbers, immigration documents or payment-card data.

The interactive assessment requests only visa category, embassy or city, disruption type, process timing and product need. A probable case number entered in the embassy field is rejected in the browser and redacted by the event endpoint.

## What is stored

Validation events are persisted to Upstash Redis to make the funnel measurable. A stored event contains only the event name, a timestamp, a random anonymous session id and the allowlisted answer fields above.

No IP address is stored. The client address is used transiently to derive a per-minute rate-limit counter, which expires within two minutes and is never written to an event record.

Session ids are generated in the browser, carry no identity, and exist to distinguish one visitor from five page reloads.

## Endpoint controls

- POST only, `application/json` only, 4 KB body limit
- Same-origin enforcement; cross-site callers rejected via `Sec-Fetch-Site`
- Strict event-name and field allowlists; unknown fields are dropped
- Per-IP rate limiting that fails open so analytics never breaks the product

## Internal dashboard

`/validation` and `/api/validation` expose business metrics and are not public. Access requires a bearer token compared in constant time, the route fails closed when `VALIDATION_TOKEN` is unset, and both are excluded from `robots.txt` and marked `noindex`.

Rotate `VALIDATION_TOKEN` with `vercel env rm` followed by `vercel env add` if it is ever shared or pasted somewhere it should not have been.

## Reporting

Please report a vulnerability through a private GitHub security advisory for this repository. Do not include real immigration identifiers or documents in a report.
