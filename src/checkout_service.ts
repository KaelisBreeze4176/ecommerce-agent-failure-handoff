import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { InfraiError } from "./infrai_observability.js";
import { processOrder } from "./order_agent_loop.js";

const checkoutBody = z.object({
  orderId: z.string().min(1),
  customerEmail: z.email(),
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

const service = express();
service.use(express.json());

service.post("/checkout", async (request, response, next) => {
  const parsed = checkoutBody.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      ok: false,
      error: "Invalid checkout request",
      issues: parsed.error.issues,
    });
    return;
  }

  try {
    const update = await processOrder(parsed.data);
    response.status(202).json({ ok: true, update });
  } catch (error) {
    next(error);
  }
});

service.use(
  (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof InfraiError && error.status >= 400 && error.status < 500) {
      response.status(error.status).json({ ok: false, error: error.detail });
      return;
    }
    console.error(error);
    response.status(502).json({ ok: false, error: "Observability request did not complete" });
  },
);

const port = Number(process.env.PORT ?? 3000);
service.listen(port, () => {
  console.log(`Checkout agent service listening on http://localhost:${port}`);
});
