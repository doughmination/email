// An in-memory stand-in for the API, used when the app is opened under /demo
// so people can try it without an account. Nothing leaves the browser:
// "sent" mail goes to Sent, mail to one of your own addresses lands in your
// inbox, and everyone else answers with a canned auto-reply. Reloading the page
// starts over.
//
// It mirrors the server's rules (routing, threading by folder, unread counts)
// closely enough to show how the app behaves, not exactly.

import type {
  AliasInfo,
  AttachmentInfo,
  ComposeInput,
  DomainInfo,
  ListFolder,
  Me,
  Message,
  Page,
  Thread,
  ThreadSummary,
  UserInfo,
} from "../../shared/types";
import type { Api } from "./api";
// A cycle (state.svelte -> api -> demo), but changed() is only called from a
// timer, long after every module has loaded.
import { changed } from "./state.svelte";

const ME = "demo";
/** Who the demo account is, until they change it in Settings. */
const ME_NAME = "Jamie Rivera";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** trashedAt is set while it's in the Bin. */
type Stored = Message & { trashedAt?: number | null };

function bare(addr: string): string {
  return (addr.match(/<([^>]*)>/)?.[1] ?? addr).trim().toLowerCase();
}

function withName(name: string | null, addr: string): string {
  const clean = (name ?? "").replace(/["<>\r\n]/g, "").trim();
  return clean ? `"${clean}" <${addr}>` : addr;
}

function snippetOf(text: string | null, html: string | null): string {
  const source = text ?? (html ?? "").replace(/<(style|head)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
  return source.replace(/\s+/g, " ").trim().slice(0, 200);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function renderHtml(text: string): string {
  const body = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.5">${body}</div>`;
}

function textFile(name: string, text: string): { info: AttachmentInfo; url: string } {
  return {
    info: {
      id: crypto.randomUUID(),
      filename: name,
      contentType: "text/plain",
      size: new TextEncoder().encode(text).length,
      contentId: null,
    },
    url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
  };
}

const WELCOME_HTML = `
<div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto; color: #1d1b20">
  <h1 style="font-size: 22px; margin: 0 0 12px">Welcome to the Inbox demo 👋</h1>
  <p>This is the real app running against a pretend server in your browser. Nothing you do here
  sends an email, and everything resets when you reload.</p>
  <p style="margin: 18px 0 6px"><strong>Things to try</strong></p>
  <ul style="padding-left: 20px; line-height: 1.7">
    <li><strong>Send yourself a message</strong>: pick any of your addresses as the recipient and it lands in your inbox.</li>
    <li><strong>Send one to anyone else</strong>: it goes to Sent, and a pretend reply comes back a few seconds later.</li>
    <li><strong>Use Cc and Bcc</strong>. Bcc'd addresses only show on your own copy in Sent.</li>
    <li><strong>Type a comma</strong> after an address in To, Cc or Bcc and it turns into a pill.</li>
    <li><strong>Use the keyboard</strong>: <kbd>R</kbd> replies, <kbd>F</kbd> forwards and <kbd>Delete</kbd> moves a conversation to the Bin, where you can restore it.</li>
    <li><strong>Switch mailboxes</strong> in the sidebar to see one address or one whole domain at a time.</li>
    <li><strong>Open Admin</strong> to switch domains off, set a catch-all, or hand yourself a new alias.</li>
  </ul>
  <p style="color: #6b6570; font-size: 13px; margin-top: 20px">Email HTML like this renders in a sandboxed frame with no script and its own styles.</p>
</div>`;

const NEWSLETTER_HTML = `
<table role="presentation" width="100%" style="background: #f4f1ee; font-family: Georgia, serif">
  <tr><td align="center" style="padding: 24px">
    <table role="presentation" width="560" style="background: #fff; border-radius: 8px; overflow: hidden">
      <tr><td><img src="https://picsum.photos/seed/inbox-demo/560/180" width="560" height="180" alt="A photo" style="display: block"></td></tr>
      <tr><td style="padding: 24px">
        <h2 style="margin: 0 0 8px; font-size: 24px">The Weekly Loaf</h2>
        <p style="color: #555">Issue 42: why your sourdough starter is sulking, and what to feed it.</p>
        <p>The picture above is a remote image. The inbox blocks those until you click
        <em>Load remote images</em>, because most of them are tracking pixels.</p>
        <p><a href="https://example.com" style="color: #b0306e">Read it on the web</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

export function createDemoApi(): Api {
  let domains: DomainInfo[] = [
    {
      name: "example.com",
      enabled: true,
      active: true,
      catchAll: ME,
      syncedAt: Date.now() - 3 * HOUR,
      resend: { status: "verified", sending: true, receiving: true },
    },
    {
      name: "example.net",
      enabled: true,
      active: true,
      catchAll: null,
      syncedAt: Date.now() - 3 * HOUR,
      resend: { status: "verified", sending: true, receiving: true },
    },
    {
      name: "example.org",
      enabled: true,
      active: false,
      catchAll: null,
      syncedAt: Date.now() - 3 * HOUR,
      resend: { status: "verified", sending: true, receiving: false },
    },
  ];
  let aliases: AliasInfo[] = [
    { localPart: "hello", domain: "example.com", username: ME },
    { localPart: "support", domain: "", username: "ari" },
  ];
  const users: { username: string; name: string | null; isAdmin: boolean; createdAt: number; lastLoginAt: number }[] = [
    { username: ME, name: ME_NAME, isAdmin: true, createdAt: Date.now() - 90 * DAY, lastLoginAt: Date.now() },
    { username: "ari", name: "Ari Lane", isAdmin: false, createdAt: Date.now() - 60 * DAY, lastLoginAt: Date.now() - 2 * DAY },
  ];
  const myName = () => users.find((u) => u.username === ME)!.name;

  /** Blob or data: URLs for attachment bytes, by attachment id. */
  const files = new Map<string, string>();
  /** Uploaded, not yet part of a message. */
  const uploads = new Map<string, AttachmentInfo>();
  const messages: Stored[] = [];
  const starred = new Set<string>();

  function addressesOf(username: string): string[] {
    const out: string[] = [];
    for (const d of domains.filter((d) => d.enabled && d.active)) {
      // A specific-domain alias wins over the every-domain one.
      const here = new Map(aliases.filter((a) => a.domain === "").map((a) => [a.localPart, a.username]));
      for (const a of aliases.filter((a) => a.domain === d.name)) here.set(a.localPart, a.username);
      if (!here.has(username)) out.push(`${username}@${d.name}`);
      for (const [local, owner] of here) if (owner === username) out.push(`${local}@${d.name}`);
    }
    return out.sort();
  }

  /** Our address mail to `addr` would reach, if any. */
  function routesToMe(addr: string): string | null {
    const [local, domain] = bare(addr).split("@");
    const d = domains.find((d) => d.name === domain && d.enabled && d.active);
    if (!d || !local) return null;
    const mine = addressesOf(ME);
    const exact = `${local}@${d.name}`;
    if (mine.includes(exact)) return exact;
    const owned = aliases.some((a) => a.localPart === local && (a.domain === d.name || a.domain === ""));
    const isUser = users.some((u) => u.username === local);
    return !owned && !isUser && d.catchAll === ME ? exact : null;
  }

  function add(m: Omit<Stored, "snippet" | "attachments" | "cc" | "bcc" | "read"> & Partial<Stored>) {
    const msg: Stored = {
      cc: [],
      bcc: [],
      read: true,
      attachments: [],
      ...m,
      snippet: snippetOf(m.text, m.html),
    };
    messages.push(msg);
    return msg;
  }

  // --- Seed mail -----------------------------------------------------------

  const now = Date.now();
  add({
    id: "welcome",
    threadId: "t-welcome",
    folder: "inbox",
    mailbox: "demo@example.com",
    from: "Inbox <hello@example.com>",
    to: ["demo@example.com"],
    subject: "Welcome to the demo",
    html: WELCOME_HTML,
    text: null,
    sentAt: now - 4 * MINUTE,
    read: false,
  });

  const notes = textFile("trip-notes.txt", "Day 1: train up, check in, find food.\nDay 2: the long walk.\nDay 3: home.\n");
  files.set(notes.info.id, notes.url);
  add({
    id: "ari-1",
    threadId: "t-ari",
    folder: "inbox",
    mailbox: "demo@example.com",
    from: "Ari Lane <ari@friends.example>",
    to: ["demo@example.com"],
    subject: "Weekend trip?",
    html: null,
    text: "Hey!\n\nStill up for the trip on the 8th? I wrote down a rough plan, it's attached.\n\nAri",
    sentAt: now - 2 * DAY,
    attachments: [notes.info],
  });
  add({
    id: "ari-2",
    threadId: "t-ari",
    folder: "sent",
    mailbox: "demo@example.com",
    from: withName(ME_NAME, "demo@example.com"),
    to: ["Ari Lane <ari@friends.example>"],
    subject: "Re: Weekend trip?",
    html: null,
    text: "Yes! The plan looks good. Can we leave a bit later on day 1?\n\n> Still up for the trip on the 8th?",
    sentAt: now - 2 * DAY + 3 * HOUR,
  });
  add({
    id: "ari-3",
    threadId: "t-ari",
    folder: "inbox",
    mailbox: "demo@example.com",
    from: "Ari Lane <ari@friends.example>",
    to: ["demo@example.com"],
    subject: "Re: Weekend trip?",
    html: null,
    text: "Sure, 11 instead of 9. See you then!\n\nAri",
    sentAt: now - 50 * MINUTE,
    read: false,
  });

  add({
    id: "news-1",
    threadId: "t-news",
    folder: "inbox",
    mailbox: "demo@example.net",
    from: "The Weekly Loaf <news@bakery.example>",
    to: ["demo@example.net"],
    subject: "Issue 42: a sulking starter",
    html: NEWSLETTER_HTML,
    text: null,
    sentAt: now - 6 * HOUR,
  });

  add({
    id: "hello-1",
    threadId: "t-hello",
    folder: "inbox",
    mailbox: "hello@example.com",
    from: "Sam Okafor <sam@client.example>",
    to: ["hello@example.com"],
    subject: "Quote for the new site",
    html: null,
    text: "Hi there,\n\nCould you send over a quote for the redesign we talked about? No rush.\n\nThanks,\nSam",
    sentAt: now - 1 * DAY,
    read: false,
  });

  add({
    id: "sent-bcc",
    threadId: "t-party",
    folder: "sent",
    mailbox: "demo@example.net",
    from: withName(ME_NAME, "demo@example.net"),
    to: ["Priya Shah <priya@party.example>", "Tom Becker <tom@party.example>"],
    cc: ["Ari Lane <ari@friends.example>"],
    bcc: ["Mo Haddad <mo@party.example>"],
    subject: "Saturday 🎉",
    html: null,
    text: "Party at mine on Saturday from 7. Bring snacks!\n\n(The Bcc above is only on this copy. Nobody else sees it.)",
    sentAt: now - 3 * DAY,
  });

  add({
    id: "draft-1",
    threadId: "t-draft",
    folder: "drafts",
    mailbox: "demo@example.com",
    from: "demo@example.com",
    to: ["Dana Whitfield <dana@flat.example>"],
    subject: "Boiler",
    html: null,
    text: "Hi,\n\nThe boiler is making the noise again. Could someone",
    sentAt: now - 5 * HOUR,
  });

  // --- Helpers -------------------------------------------------------------

  /** Feels like a network, and lets the app's loading states show. */
  const later = <T>(value: () => T, ms = 120): Promise<T> =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(structuredClone(value()));
        } catch (e) {
          reject(e);
        }
      }, ms),
    );

  function unread(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const m of messages) if (m.folder === "inbox" && !m.read && !m.trashedAt) out[m.mailbox] = (out[m.mailbox] ?? 0) + 1;
    return out;
  }

  function remove(pred: (m: Stored) => boolean, mustExist = true): number {
    let n = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (pred(messages[i]!)) {
        messages.splice(i, 1);
        n++;
      }
    }
    if (!n && mustExist) throw new Error("Not found");
    return n;
  }

  /** Into the Bin, or with trash false, back out of it. */
  function setTrashed(pred: (m: Stored) => boolean, trash: boolean): number {
    const hits = messages.filter((m) => pred(m) && !m.trashedAt === trash);
    if (!hits.length) throw new Error("Not found");
    for (const m of hits) m.trashedAt = trash ? Date.now() : null;
    return hits.length;
  }

  function attachmentsFor(ids: string[], keep: AttachmentInfo[] = []): AttachmentInfo[] {
    const known = new Map(messages.flatMap((m) => m.attachments).map((a) => [a.id, a]));
    for (const a of keep) known.set(a.id, a);
    return ids.map((id) => {
      const a = uploads.get(id) ?? known.get(id);
      if (!a) throw new Error("One of the attachments is gone.");
      uploads.delete(id);
      return a;
    });
  }

  function saveDraft(input: ComposeInput, draftId?: string | null): Stored {
    const mine = addressesOf(ME);
    if (!mine.includes(bare(input.from))) throw new Error(`You can't send from ${bare(input.from) || "that address"}.`);
    const fields = {
      mailbox: bare(input.from),
      from: bare(input.from),
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      html: renderHtml(input.text),
      snippet: snippetOf(input.text, null),
      sentAt: Date.now(),
    };

    if (draftId) {
      const draft = messages.find((m) => m.id === draftId && m.folder === "drafts" && !m.trashedAt);
      if (!draft) throw new Error("That draft doesn't exist any more.");
      Object.assign(draft, fields, { attachments: attachmentsFor(input.attachmentIds, draft.attachments) });
      return draft;
    }
    const original = input.replyTo ? messages.find((m) => m.id === input.replyTo) : null;
    if (input.replyTo && !original) throw new Error("The message you're replying to is gone.");
    return add({
      id: crypto.randomUUID(),
      threadId: original?.threadId ?? crypto.randomUUID(),
      folder: "drafts",
      ...fields,
      attachments: attachmentsFor(input.attachmentIds),
    });
  }

  function deliver(sent: Stored) {
    const everyone = [...sent.to, ...sent.cc, ...sent.bcc];
    const ours = new Set(everyone.map(routesToMe).filter((a): a is string => a !== null));
    for (const mailbox of ours) {
      add({ ...sent, id: crypto.randomUUID(), folder: "inbox", mailbox, bcc: [], read: false });
    }

    // Anyone outside answers after a moment, so there's something to read.
    const outside = everyone.find((a) => routesToMe(a) === null && !users.some((u) => addressesOf(u.username).includes(bare(a))));
    if (!outside) return;
    setTimeout(() => {
      if (!messages.some((m) => m.threadId === sent.threadId)) return;
      add({
        id: crypto.randomUUID(),
        threadId: sent.threadId,
        folder: "inbox",
        mailbox: sent.mailbox,
        from: outside,
        to: [sent.from],
        subject: /^re:/i.test(sent.subject) ? sent.subject : `Re: ${sent.subject}`,
        html: null,
        text:
          "Thanks, got it!\n\n(This is a pretend reply from the demo. Your message wasn't really sent anywhere.)\n\n" +
          (sent.text ?? "").split("\n").map((l) => `> ${l}`).join("\n"),
        sentAt: Date.now(),
        read: false,
      });
      changed();
    }, 5000);
  }

  function summaries(folder: ListFolder, mailbox: string | null): ThreadSummary[] {
    const inFolder = messages.filter(
      (m) =>
        (folder === "bin"
          ? !!m.trashedAt
          : folder === "starred"
            ? starred.has(m.threadId) && !m.trashedAt
            : m.folder === folder && !m.trashedAt) &&
        (!mailbox || (mailbox.startsWith("@") ? m.mailbox.endsWith(mailbox.toLowerCase()) : m.mailbox === mailbox.toLowerCase())),
    );
    const byThread = new Map<string, Stored[]>();
    for (const m of inFolder) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);
    return [...byThread]
      .map(([id, list]) => {
        const latest = list.reduce((a, b) => (b.sentAt > a.sentAt ? b : a));
        return {
          id,
          latestId: latest.id,
          mailbox: latest.mailbox,
          subject: latest.subject,
          from: latest.from,
          to: latest.to,
          snippet: latest.snippet,
          lastAt: latest.sentAt,
          count: list.length,
          unread: list.filter((m) => !m.read).length,
          hasAttachments: messages.some((m) => m.threadId === id && m.attachments.some((a) => !a.contentId)),
          starred: starred.has(id),
        };
      })
      .sort((a, b) => b.lastAt - a.lastAt);
  }

  function userInfo(u: (typeof users)[number]): UserInfo {
    return { ...u, messageCount: u.username === ME ? messages.length : 7, addresses: addressesOf(u.username) };
  }

  function domainInfo(d: DomainInfo): DomainInfo {
    return { ...d, active: d.enabled && (d.resend?.receiving ?? false) };
  }

  // --- The API -------------------------------------------------------------

  return {
    me: () =>
      later<Me>(() => ({
        username: ME,
        name: myName(),
        isAdmin: users.find((u) => u.username === ME)!.isAdmin,
        addresses: addressesOf(ME),
        domains: domains.filter((d) => d.enabled).map((d) => d.name),
        pushPublicKey: null,
      })),
    // Reloading the page starts the demo over.
    logout: () => later(() => ({ endSession: "/demo" as string | null })),
    setName: (name) =>
      later(() => {
        const me = users.find((u) => u.username === ME)!;
        me.name = name.trim().slice(0, 100) || null;
        return { name: me.name };
      }),

    threads: (folder, mailbox) =>
      later<Page<ThreadSummary>>(() => ({ items: summaries(folder, mailbox), nextCursor: null })),
    thread: (id, bin) =>
      later<Thread>(() => {
        const list = messages.filter((m) => m.threadId === id && !!m.trashedAt === !!bin).sort((a, b) => a.sentAt - b.sentAt);
        if (!list.length) throw new Error("Not found");
        return {
          id,
          subject: list.at(-1)!.subject,
          starred: starred.has(id),
          messages: list,
        };
      }),
    markThread: (id, read) =>
      later(() => {
        for (const m of messages) if (m.threadId === id && m.folder === "inbox") m.read = read;
        return { unread: unread() };
      }),
    starThread: (id, star) =>
      later(() => {
        if (star) starred.add(id);
        else starred.delete(id);
        return { starred: star };
      }),
    deleteThread: (id, forever) =>
      later(() => ({
        count: forever
          ? remove((m) => m.threadId === id && !!m.trashedAt)
          : setTrashed((m) => m.threadId === id, true),
      })),
    restoreThread: (id) => later(() => ({ count: setTrashed((m) => m.threadId === id, false) })),
    emptyBin: () => later(() => ({ count: remove((m) => !!m.trashedAt, false) })),
    message: (id) =>
      later<Message>(() => {
        const m = messages.find((m) => m.id === id);
        if (!m) throw new Error("Not found");
        return m;
      }),
    deleteMessage: (id, forever) =>
      later(() => ({ count: forever ? remove((m) => m.id === id) : setTrashed((m) => m.id === id, true) })),
    restoreMessage: (id) => later(() => ({ count: setTrashed((m) => m.id === id, false) })),
    unread: () => later(() => ({ unread: unread() })),
    attachmentUrl: (id) => files.get(id) ?? "data:text/plain,This%20attachment%20is%20gone.",

    upload: (file) =>
      later<AttachmentInfo>(() => {
        if (file.size > 25 * 1024 * 1024) throw new Error("Attachments can be up to 25 MB each.");
        const info: AttachmentInfo = {
          id: crypto.randomUUID(),
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          contentId: null,
        };
        files.set(info.id, URL.createObjectURL(file));
        uploads.set(info.id, info);
        return info;
      }, 400),
    createDraft: (input) => later(() => ({ id: saveDraft(input).id })),
    updateDraft: (id, input) => later(() => ({ id: saveDraft(input, id).id })),
    send: (input, draftId) =>
      later(() => {
        const draft = saveDraft(input, draftId);
        if (!draft.to.length) throw new Error("Add at least one recipient.");
        if (!draft.subject.trim()) throw new Error("Add a subject.");
        draft.folder = "sent";
        draft.from = withName(myName(), draft.from);
        draft.sentAt = Date.now();
        deliver(draft);
        return { id: draft.id, threadId: draft.threadId };
      }, 500),

    pushSubscribe: () => later(() => ({})),
    pushUnsubscribe: () => later(() => ({})),
    pushTest: () => later(() => ({ sent: 0 })),

    admin: {
      domains: () =>
        later(() => {
          for (const d of domains) d.syncedAt = Date.now();
          return { domains: domains.map(domainInfo), syncError: null as string | null };
        }),
      saveDomain: (name, enabled, catchAll) =>
        later(() => {
          domains = domains.map((d) => (d.name === name ? domainInfo({ ...d, enabled, catchAll }) : d));
          return {};
        }),
      aliases: () => later(() => aliases),
      addAlias: (a) =>
        later(() => {
          const localPart = a.localPart.trim().toLowerCase();
          if (!/^[a-z0-9._+-]+$/.test(localPart)) throw new Error("That isn't a valid local part.");
          if (!users.some((u) => u.username === a.username)) throw new Error("Pick a user.");
          if (aliases.some((x) => x.localPart === localPart && x.domain === a.domain)) throw new Error("That alias already exists.");
          aliases = [...aliases, { ...a, localPart }];
          return {};
        }),
      deleteAlias: (a) =>
        later(() => {
          aliases = aliases.filter((x) => !(x.localPart === a.localPart && x.domain === a.domain));
          return {};
        }),
      users: () => later(() => users.map(userInfo)),
      setAdmin: (username, isAdmin) =>
        later(() => {
          const u = users.find((u) => u.username === username);
          if (u) u.isAdmin = isAdmin;
          return {};
        }),
      deleteUser: (username) =>
        later(() => {
          if (username === ME) throw new Error("You can't delete yourself.");
          const i = users.findIndex((u) => u.username === username);
          if (i < 0) throw new Error("Not found");
          users.splice(i, 1);
          aliases = aliases.filter((a) => a.username !== username);
          return { deletedMail: 7 };
        }),
    },
  };
}
