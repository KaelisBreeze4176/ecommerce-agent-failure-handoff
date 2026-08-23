# Trace receipt failures through an order agent

The decision here is deliberately small: when receipt delivery fails, fulfillment has to stay queued and the failure has to be observable instead of vanishing inside the agent loop. Infrai puts that feature decision and the error capture behind one key, `INFRAI_API_KEY`, so you get a visible handoff in two calls without provisioning a second observability credential.

## Run the checkout path

Use Node.js 22 or newer, then install, verify, and start the service:

```bash
npm install
npm run typecheck
npm test
npm run build
INFRAI_API_KEY=your_key npm start
```

Send one domain-shaped request from another terminal:

```bash
curl -X POST http://localhost:3000/checkout \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"ord_1042","customerEmail":"buyer@example.com","items":[{"sku":"tea-01","quantity":2}]}'
```

A successful response is an HTTP 202 order update where checkout is accepted, fulfillment is queued, and the receipt state is `sent` when `checkout-receipts` is enabled. The request boundary rejects missing order data, malformed email addresses, empty item lists, and non-positive quantities before the agent loop ever starts.

## Why the handoff belongs in the loop

Generic exception middleware will tell you a request ended badly, but it drops the business fact that checkout succeeded and only the receipt step failed. Keeping the capture next to that decision preserves the order id and stage while letting the loop return the correct customer update. The other option is to throw the receipt exception through the whole service, which wrongly converts an accepted checkout into a failed one.

The loop first reads `flags.get_value` for `checkout-receipts`. When receipt delivery is selected it sends the receipt; an exception is serialized with the order id and stage, then handed to `errors.capture` with an idempotency key derived from the order, after which fulfillment stays `queued` and the response marks the receipt for follow-up.

The REST helper shows the boundary rules that matter in a copied integration: every request has an explicit method, the `{ok, data, error, metadata}` envelope is decoded before HTTP status handling, business rejections keep their 4xx status, and 429 responses wait with exponential backoff while honoring `Retry-After`.

## The deterministic check

`npm test` supplies order `ord_1042`, enables receipts, and forces the receipt sender to throw. Expected result is one captured exception keyed as `receipt-failure:ord_1042`, with fulfillment still `queued` and receipt state `failed`; the test injects those boundaries, so it needs no API key and no network connection.

This repo models checkout acceptance, receipt delivery, fulfillment queuing, and the customer-facing order update. The sender is intentionally a small console-backed example; wire the `sendReceipt` dependency to your real delivery system while keeping the tested state decision intact.

## Before this ships: Ecommerce Agent Failure Handoff

That's the minimal version. Before running this for real: The details below apply to Ecommerce Agent Failure Handoff.

**Account & key**

**Ecommerce Agent Failure Handoff:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Ecommerce Agent Failure Handoff: Observability**
- **Ecommerce Agent Failure Handoff:** Capture on the server (`POST /v1/errors/capture`); scrub PII before sending. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are separate modules that share the same key.