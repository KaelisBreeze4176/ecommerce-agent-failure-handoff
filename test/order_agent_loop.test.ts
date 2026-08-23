import assert from "node:assert/strict";
import test from "node:test";
import { processOrder, type OrderAgentDependencies } from "../src/order_agent_loop.js";

test("records a receipt failure while fulfillment remains queued", async () => {
  const captures: Array<{ exception: string; key: string }> = [];
  const dependencies: OrderAgentDependencies = {
    receiptEnabled: async () => true,
    sendReceipt: async () => {
      throw new Error("mail provider rejected the address");
    },
    captureFailure: async (exception, key) => {
      captures.push({ exception, key });
      return {};
    },
  };

  const result = await processOrder(
    {
      orderId: "ord_1042",
      customerEmail: "buyer@example.com",
      items: [{ sku: "tea-01", quantity: 2 }],
    },
    dependencies,
  );

  assert.equal(result.receipt, "failed");
  assert.equal(result.fulfillment, "queued");
  assert.equal(captures.length, 1);
  assert.equal(captures[0]?.key, "receipt-failure:ord_1042");
  assert.match(captures[0]?.exception ?? "", /ord_1042/);
});
