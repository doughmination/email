import { Resend } from "resend";

export function resend(env: Env): Resend {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(env.RESEND_API_KEY);
}
