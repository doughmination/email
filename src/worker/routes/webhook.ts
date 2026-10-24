import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { syncDomains } from "../services/domains";
import { receiveEmail } from "../services/inbound";
import { resend } from "../services/resend";

export const webhook = new Hono<AppEnv>().post("/inbound", async (c) => {
  const payload = await c.req.text();

  let event;
  try {
    event = resend(c.env).webhooks.verify({
      payload,
      headers: {
        id: c.req.header("svix-id") ?? "",
        timestamp: c.req.header("svix-timestamp") ?? "",
        signature: c.req.header("svix-signature") ?? "",
      },
      webhookSecret: c.env.RESEND_WEBHOOK_SECRET,
    });
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return c.text("Invalid signature", 401);
  }

  // Subscribe the webhook to domain.* too and new domains appear on their own.
  if (event.type.startsWith("domain.")) return c.json({ ok: true, ...(await syncDomains(c.env)) });
  if (event.type !== "email.received") return c.json({ ok: true, ignored: event.type });

  // Errors propagate as a 500 so Resend retries; receiveEmail is idempotent.
  return c.json({ ok: true, ...(await receiveEmail(c.env, event.data.email_id)) });
});
