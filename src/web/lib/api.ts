import type {
  AliasInfo,
  AttachmentInfo,
  ComposeInput,
  DomainInfo,
  Folder,
  Me,
  Message,
  Page,
  Thread,
  ThreadSummary,
  UserInfo,
} from "../../shared/types";
import { createDemoApi } from "./demo";
import { isDemo } from "./router.svelte";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    method,
    headers: body !== undefined && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = `/auth/login?from=${encodeURIComponent(location.pathname + location.search)}`;
    throw new ApiError("Signed out", 401);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
const del = <T>(path: string) => request<T>("DELETE", path);

type Unread = { unread: Record<string, number> };

const server = {
  me: () => get<Me>("/api/me"),
  logout: () => post<{ endSession: string | null }>("/auth/logout"),

  threads(folder: Folder, mailbox: string | null, cursor?: string | null) {
    const q = new URLSearchParams({ folder });
    if (mailbox) q.set("mailbox", mailbox);
    if (cursor) q.set("cursor", cursor);
    return get<Page<ThreadSummary>>(`/api/threads?${q}`);
  },
  thread: (id: string) => get<Thread>(`/api/threads/${id}`),
  markThread: (id: string, read: boolean) => post<Unread>(`/api/threads/${id}/read`, { read }),
  deleteThread: (id: string) => del<{ count: number }>(`/api/threads/${id}`),
  message: (id: string) => get<Message>(`/api/messages/${id}`),
  deleteMessage: (id: string) => del<{ count: number }>(`/api/messages/${id}`),
  unread: () => get<Unread>("/api/unread"),
  attachmentUrl: (id: string, inline = false) => `/api/attachments/${id}${inline ? "?inline=1" : ""}`,

  upload(file: File) {
    const form = new FormData();
    form.set("file", file);
    return request<AttachmentInfo>("POST", "/api/uploads", form);
  },
  createDraft: (input: ComposeInput) => post<{ id: string }>("/api/drafts", input),
  updateDraft: (id: string, input: ComposeInput) => put<{ id: string }>(`/api/drafts/${id}`, input),
  send: (input: ComposeInput, draftId: string | null) =>
    post<{ id: string; threadId: string }>("/api/send", { ...input, draftId }),

  pushSubscribe: (sub: PushSubscriptionJSON) => post("/api/push/subscribe", sub),
  pushUnsubscribe: (endpoint: string) => post("/api/push/unsubscribe", { endpoint }),
  pushTest: () => post<{ sent: number }>("/api/push/test"),

  admin: {
    /** Syncs from Resend first; syncError is set when Resend couldn't be reached. */
    domains: () => get<{ domains: DomainInfo[]; syncError: string | null }>("/api/admin/domains"),
    saveDomain: (name: string, enabled: boolean, catchAll: string | null) =>
      put(`/api/admin/domains/${encodeURIComponent(name)}`, { enabled, catchAll }),
    aliases: () => get<AliasInfo[]>("/api/admin/aliases"),
    addAlias: (a: AliasInfo) => post("/api/admin/aliases", a),
    deleteAlias: (a: AliasInfo) =>
      del(`/api/admin/aliases/${encodeURIComponent(a.domain || "*")}/${encodeURIComponent(a.localPart)}`),
    users: () => get<UserInfo[]>("/api/admin/users"),
    setAdmin: (username: string, isAdmin: boolean) =>
      patch(`/api/admin/users/${encodeURIComponent(username)}`, { isAdmin }),
    deleteUser: (username: string) =>
      del<{ deletedMail: number }>(`/api/admin/users/${encodeURIComponent(username)}`),
  },
};

export type Api = typeof server;

/** Under /demo the server is swapped for an in-memory fake; see demo.ts. */
export const api: Api = isDemo ? createDemoApi() : server;
