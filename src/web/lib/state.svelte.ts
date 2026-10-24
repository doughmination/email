import type { AttachmentInfo, Me, Message } from "../../shared/types";
import { api } from "./api";

export const session = $state({
  me: null as Me | null,
  /** Unread inbox mail per receiving address. */
  unread: {} as Record<string, number>,
  /** Bumped after anything that changes the lists, so they reload. */
  version: 0,
});

export async function loadSession() {
  const [me, { unread }] = await Promise.all([api.me(), api.unread()]);
  session.me = me;
  session.unread = unread;
}

export function changed(unread?: Record<string, number>) {
  if (unread) session.unread = unread;
  else void api.unread().then((r) => (session.unread = r.unread));
  session.version++;
}

export interface ComposeInit {
  title: string;
  draftId: string | null;
  replyTo: string | null;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  attachments: AttachmentInfo[];
}

export const composer = $state({ open: null as ComposeInit | null });

function defaultFrom(): string {
  return session.me?.addresses[0] ?? "";
}

/** The address of ours a message was sent to, so a reply goes out from it. */
function ourAddress(m: Message): string {
  const mine = session.me?.addresses ?? [];
  return mine.includes(m.mailbox) ? m.mailbox : defaultFrom();
}

function quote(m: Message): string {
  const when = new Date(m.sentAt).toLocaleString();
  const body = (m.text ?? "").split("\n").map((l) => `> ${l}`).join("\n");
  return `\n\nOn ${when}, ${m.from} wrote:\n${body}`;
}

function prefixed(prefix: string, subject: string): string {
  return new RegExp(`^\\s*${prefix}\\s*:`, "i").test(subject) ? subject : `${prefix}: ${subject}`;
}

export function composeNew() {
  composer.open = {
    title: "New message",
    draftId: null,
    replyTo: null,
    from: defaultFrom(),
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    text: "",
    attachments: [],
  };
}

export function composeReply(m: Message) {
  const outbound = m.folder !== "inbox";
  composer.open = {
    title: "Reply",
    draftId: null,
    replyTo: m.id,
    from: ourAddress(m),
    to: outbound ? [...m.to] : [m.from],
    cc: [],
    bcc: [],
    subject: prefixed("Re", m.subject),
    text: quote(m),
    attachments: [],
  };
}

export function composeForward(m: Message) {
  composer.open = {
    title: "Forward",
    draftId: null,
    replyTo: null,
    from: ourAddress(m),
    to: [],
    cc: [],
    bcc: [],
    subject: prefixed("Fwd", m.subject),
    text: `\n\n---------- Forwarded message ----------\nFrom: ${m.from}\nTo: ${m.to.join(", ")}\nSubject: ${m.subject}\n\n${m.text ?? ""}`,
    attachments: m.attachments.filter((a) => !a.contentId),
  };
}

export function composeDraft(m: Message) {
  composer.open = {
    title: "Draft",
    draftId: m.id,
    replyTo: null,
    from: m.from,
    to: [...m.to],
    cc: [...m.cc],
    bcc: [...m.bcc],
    subject: m.subject,
    text: m.text ?? "",
    attachments: m.attachments,
  };
}
