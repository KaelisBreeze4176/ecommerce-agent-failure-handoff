import { infrai } from "./infrai_observability.js";

export type CheckoutCommand = {
  orderId: string;
  customerEmail: string;
  items: Array<{ sku: string; quantity: number }>;
};

export type OrderUpdate = {
  orderId: string;
  checkout: "accepted";
  fulfillment: "queued";
  receipt: "sent" | "skipped" | "failed";
  customerMessage: string;
};

export type OrderAgentDependencies = {
  receiptEnabled: () => Promise<boolean>;
  sendReceipt: (command: CheckoutCommand) => Promise<void>;
  captureFailure: (exception: string, idempotencyKey: string) => Promise<unknown>;
};

export const liveDependencies: OrderAgentDependencies = {
  receiptEnabled: () => infrai.flags.get_value("checkout-receipts"),
  sendReceipt: async ({ customerEmail }) => {
    console.log(`Receipt sent to ${customerEmail}`);
  },
  captureFailure: (exception, idempotencyKey) =>
    infrai.errors.capture(exception, idempotencyKey),
};

function describeFailure(error: unknown, command: CheckoutCommand): string {
  const cause = error instanceof Error ? error : new Error(String(error));
  return JSON.stringify({
    name: cause.name,
    message: cause.message,
    stack: cause.stack,
    orderId: command.orderId,
    stage: "receipt",
  });
}

export async function processOrder(
  command: CheckoutCommand,
  dependencies: OrderAgentDependencies = liveDependencies,
): Promise<OrderUpdate> {
  if (!(await dependencies.receiptEnabled())) {
    return {
      orderId: command.orderId,
      checkout: "accepted",
      fulfillment: "queued",
      receipt: "skipped",
      customerMessage: "Order accepted; fulfillment is queued.",
    };
  }

  try {
    await dependencies.sendReceipt(command);
    return {
      orderId: command.orderId,
      checkout: "accepted",
      fulfillment: "queued",
      receipt: "sent",
      customerMessage: "Order accepted; receipt sent and fulfillment queued.",
    };
  } catch (error) {
    await dependencies.captureFailure(
      describeFailure(error, command),
      `receipt-failure:${command.orderId}`,
    );
    return {
      orderId: command.orderId,
      checkout: "accepted",
      fulfillment: "queued",
      receipt: "failed",
      customerMessage: "Order accepted; fulfillment queued and receipt follow-up recorded.",
    };
  }
}
