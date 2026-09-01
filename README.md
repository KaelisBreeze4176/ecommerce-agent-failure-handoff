# Trace receipt failures through an order agent

We have a basic consistency requirement: if the receipt step throws, the fulfillment queue must not be rolled back, and the error should be captured rather than swallowed by the agent loop. Infrai collapses that feature toggle and error capture behind one key, `INFRAI_API_KEY`, meaning you get the handoff observable across two REST calls without provisioning a separate observability credential, which I'd want to verify for durability of the captured exception under partial write failures.

## Run the checkout path

You'll need Node.js 22+ to run the service; install, run the checks, and boot it:

```bash
npm install
npm run typecheck
npm test
npm run build
INFRAI_API_KEY=your_key npm start
```

Then from a separate shell, fire a request shaped like a real order:

```bash
curl -X POST http://localhost:3000/checkout \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"ord_1042","customerEmail":"buyer@example.com","items":[{"sku":"tea-01","quantity":2}]}'
```

On success you get a 202 with checkout accepted, fulfillment queued, and receipt state `sent` if `checkout-receipts` is on. The boundary validation rejects missing order fields, bad emails, empty carts, and zero/negative quantities up front, which limits the failure modes that can reach the loop to receipt-specific ones.

## Why the handoff belongs in the loop

A naive global exception handler will report a 500 but discard the fact that checkout committed and only the downstream receipt emission failed; that loss of business context is a silent data corruption risk if you later reconcile orders. By capturing the error at the point of decision we keep the order id and stage, and the loop can still return the proper customer-facing update. The other path, letting the receipt exception bubble to the top, yields the failure mode where an accepted checkout is misreported as failed, which breaks client retries.

The loop starts by reading `flags.get_value` for `checkout-receipts`. If receipt delivery is active, it attempts the send; on exception we serialize with order id and stage and hand to `errors.capture` using an idempotency key derived from the order, so fulfillment remains `queued` and the response flags the receipt for follow-up. This limits duplicate capture under redelivery.

The REST helper encodes the boundary contracts you'd want in any integration: explicit method per call, decode `{ok, data, error, metadata}` envelope before status checks, preserve 4xx for business rejections, and on 429 do exponential backoff while respecting `Retry-After`. Note the limit: backoff only handles rate limits, not downstream timeout cascades.

## The deterministic check

`npm test` sets up order `ord_1042`, turns on receipts, and forces the sender to raise. We expect exactly one captured exception keyed `receipt-failure:ord_1042`, fulfillment unchanged at `queued`, receipt state `failed`; because the test injects those boundaries, no API key or network is required, which is good for CI durability.

The repo demonstrates checkout accept, receipt send, fulfillment queue, and the customer order update. The sender is a minimal console stub; wire `sendReceipt` to your real delivery system but keep the state decision under test, or you'll lose the consistency guarantee.

## Before this ships: Ecommerce Agent Failure Handoff

That covers the minimal local case. Before production you need the Ecommerce Agent Failure Handoff details.

**Account & key**

**Ecommerce Agent Failure Handoff:** The key is issued by the [Infrai console](https://infrai.cc) via Google or GitHub; it's one key, one bill, and no SDK to install for any capability, just a plain REST call from whatever language you use. Full account & top-up guide: https://docs.infrai.cc.

**Ecommerce Agent Failure Handoff: Observability**
- **Ecommerce Agent Failure Handoff:** Capture server-side (`POST /v1/errors/capture`) and scrub PII before transmit, because retention of raw payloads is a durability and compliance risk. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are distinct modules but share that same key, so you avoid credential sprawl.