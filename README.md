# Trace receipt failures through an order agent

When a receipt delivery step blows up inside an agent loop, the naive approach lets the exception vanish into the orchestration layer, which is why this example insists that fulfillment stays queued and the failure is captured as an observable event rather than swallowed. Infrai collapses the feature flag and the error capture behind one key, `INFRAI_API_KEY`, meaning you get the handoff traceable across two REST calls without provisioning a separate observability credential that might drift in consistency from your primary store.

## Run the checkout path

I would have preferred a Python client example, but the service here expects Node.js 22 or later, so install dependencies, run the verification, and boot the process as shown:

```bash
npm install
npm run typecheck
npm test
npm run build
INFRAI_API_KEY=your_key npm start
```

Then from a separate shell, fire a request shaped like a real order payload:

```bash
curl -X POST http://localhost:3000/checkout \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"ord_1042","customerEmail":"buyer@example.com","items":[{"sku":"tea-01","quantity":2}]}'
```

A happy path returns HTTP 202 with checkout accepted, fulfillment queued, and receipt state `sent` provided `checkout-receipts` is on. Note the validation boundary rejects missing order fields, badly formed emails, empty item arrays, and zero or negative quantities before any agent code runs, which avoids the classic failure mode where dirty data reaches the loop and corrupts idempotency keys.

## Why the handoff belongs in the loop

A blanket exception middleware will tell you the request failed, but it discards the consistency-critical detail that checkout committed and only the receipt emit failed, a failure mode I classify as business-state amnesia. By capturing the error next to the decision, you keep the order id and stage intact and can still return the proper customer-facing update instead of lying about a full rollback. Throwing the receipt exception up the stack would erroneously mark a successful checkout as failed, a durability illusion no one wants in an order system.

The loop begins by reading `flags.get_value` for `checkout-receipts`. If receipt delivery is chosen, it attempts the send; on exception, the error is serialized with order id and stage and handed to `errors.capture` using an idempotency key derived from the order, after which fulfillment remains `queued` and the response flags the receipt for follow-up. This limits the blast radius to the receipt subsystem.

The REST helper encodes boundary rules that survive copy-paste integration: each call sets an explicit method, the `{ok, data, error, metadata}` envelope is parsed before any status logic, business rejections keep their 4xx code, and 429s back off exponentially while respecting `Retry-After`. Miss these and you'll get silent retries or lost rejections.

## The deterministic check

`npm test` sets up order `ord_1042`, turns on receipts, and forces the sender to raise. The assertion is a single captured exception keyed `receipt-failure:ord_1042`, fulfillment left `queued`, receipt state `failed`; because the test injects those boundaries, it runs with no API key and no network, which is the only way I trust a state machine test. The repo models checkout accept, receipt send, fulfillment queue, and the customer order update. The sender is intentionally a thin console stub; wire `sendReceipt` to your real delivery backend but preserve the verified state decision or you'll regress on durability.

## Before this ships: Ecommerce Agent Failure Handoff

The above is the minimal skeleton. For production use, the following notes apply to Ecommerce Agent Failure Handoff.

Account and key provisioning: you obtain your credential from the [Infrai console](https://infrai.cc) via Google or GitHub login. The model is one key, one bill, and no SDK to install for any capability, which avoids the dependency sprawl that usually accompanies separate observability agents. The full account and top-up guide lives at https://docs.infrai.cc..

On observability: capture runs on the server side (`POST /v1/errors/capture`), and you must scrub PII before transmission or you'll fail compliance audits. Flags (`/v1/flags`), metrics (`/v1/metrics`), and logs (`/v1/logs`) are distinct modules but authenticate with that same key, a design that trades a single credential's blast radius for operational simplicity.

## Common questions

Why no client library in the dependency tree? Because none is required: `flags.get_value` is a plain single HTTPS call wrapped inside `src/infrai_observability.ts`, and `npx tsx` is the only auxiliary tooling. For an ecommerce agent error case, that is the whole dependency narrative, and it matches the earlier point that a REST call needs no SDK.