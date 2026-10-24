import { Hono } from "hono";
import type { AppEnv } from "../middleware";
import { syncDomains } from "../services/domains";
import { receiveBounce, receiveEmail } from "../services/inbound";
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
  // Errors propagate as a 500 so Resend retries; both handlers are idempotent.
  if (event.type === "email.bounced") {
    const { data } = event;
    return c.json({
      ok: true,
      ...(await receiveBounce(c.env, {
        emailId: data.email_id,
        to: data.to,
        subject: data.subject,
        bouncedAt: event.created_at,
        type: data.bounce.type,
        subType: data.bounce.subType,
        message: data.bounce.message,
      })),
    });
  }
  if (event.type !== "email.received") return c.json({ ok: true, ignored: event.type });

  return c.json({ ok: true, ...(await receiveEmail(c.env, event.data.email_id)) });
});
