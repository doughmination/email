import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const OIDC = {
  issuer: (process.env.OIDC_ISSUER || "").replace(/\/+$/, ""),
  clientId: process.env.OIDC_CLIENT_ID || "",
  clientSecret: process.env.OIDC_CLIENT_SECRET || "",
  redirectUri: process.env.OIDC_REDIRECT_URI || "",
  // offline_access is what gets a refresh token, which sessions use to keep
  // checking that the SSO still vouches for the account.
  scope: process.env.OIDC_SCOPE || "openid profile email offline_access",
  postLogoutRedirectUri: process.env.OIDC_POST_LOGOUT_REDIRECT_URI || "",
};

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
}

let discovery: Discovery | null = null;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

async function getDiscovery(): Promise<Discovery> {
  if (discovery && jwks) return discovery;

  const url = `${OIDC.issuer}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) at ${url}`);
  }

  const doc = (await res.json()) as Discovery;
  if (doc.issuer !== OIDC.issuer) {
    throw new Error(`OIDC issuer mismatch: configured ${OIDC.issuer}, discovered ${doc.issuer}`);
  }
  discovery = doc;
  jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
  return discovery;
}

export async function initOidc(): Promise<void> {
  const missing = [
    ["OIDC_ISSUER", OIDC.issuer],
    ["OIDC_CLIENT_ID", OIDC.clientId],
    ["OIDC_CLIENT_SECRET", OIDC.clientSecret],
    ["OIDC_REDIRECT_URI", OIDC.redirectUri],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length) {
    throw new Error(`Missing OIDC env vars: ${missing.join(", ")}`);
  }

  await getDiscovery();
  console.log(`OIDC ready - issuer ${OIDC.issuer}`);
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

function sanitizeUsername(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pickUsername(claims: Record<string, unknown>): string {
  const email = typeof claims.email === "string" ? claims.email.split("@")[0] : "";
  const raw =
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    email ||
    (typeof claims.sub === "string" && claims.sub) ||
    "";
  return sanitizeUsername(String(raw));
}

/** Same-site paths only: "/x" yes; "//host", "/\host" and absolute URLs no. */
export function safeReturnTo(raw: string | undefined, fallback = "/inbox"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

export interface Pending {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
}

export async function buildAuthUrl(returnTo: string): Promise<{ url: string; pending: Pending }> {
  const d = await getDiscovery();

  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(32);
  const codeChallenge = b64url(await sha256(codeVerifier));

  const url = new URL(d.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OIDC.clientId);
  url.searchParams.set("redirect_uri", OIDC.redirectUri);
  url.searchParams.set("scope", OIDC.scope);
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    url: url.toString(),
    pending: { state, nonce, codeVerifier, returnTo: safeReturnTo(returnTo) },
  };
}

/** RFC 9207: when the SSO names itself on the callback, it must be the one we asked. */
export function issuerMatches(iss: string | undefined): boolean {
  return iss === undefined || iss === OIDC.issuer;
}

export interface TokenSet {
  username: string;
  sub: string;
  refreshToken: string | null;
  idToken: string;
}

export class GrantRejected extends Error {}

async function tokenRequest(params: Record<string, string>): Promise<{ id_token?: string; refresh_token?: string }> {
  const d = await getDiscovery();
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: OIDC.clientId,
      client_secret: OIDC.clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    let error = "";
    try {
      error = (JSON.parse(text) as { error?: string }).error ?? "";
    } catch {
      // not JSON
    }
    // invalid_grant is the SSO's definitive "no"; anything else might be transient.
    if (error === "invalid_grant") throw new GrantRejected(text);
    throw new Error(`token request failed (${res.status}): ${text}`);
  }
  return (await res.json()) as { id_token?: string; refresh_token?: string };
}

async function verifyIdToken(idToken: string): Promise<JWTPayload> {
  const d = await getDiscovery();
  const { payload } = await jwtVerify(idToken, jwks!, {
    issuer: d.issuer,
    audience: OIDC.clientId,
  });
  return payload;
}

export async function completeLogin(code: string, pending: Pending): Promise<TokenSet> {
  const tokens = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: OIDC.redirectUri,
    code_verifier: pending.codeVerifier,
  });
  if (!tokens.id_token) throw new Error("no id_token returned");

  const payload = await verifyIdToken(tokens.id_token);
  if (payload.nonce !== pending.nonce) throw new Error("nonce mismatch");

  const username = pickUsername(payload as Record<string, unknown>);
  if (!username) throw new Error("no usable username in token");

  return {
    username,
    sub: String(payload.sub || ""),
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token,
  };
}

/**
 * Asks the SSO whether it still vouches for a session. Throws GrantRejected
 * when it doesn't (account disabled, removed from the app's allowed groups,
 * signed out everywhere); other errors mean it couldn't be asked.
 */
export async function refreshSession(refreshToken: string): Promise<{ sub: string; refreshToken: string | null; idToken: string | null }> {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  const payload = tokens.id_token ? await verifyIdToken(tokens.id_token) : null;
  return {
    sub: payload ? String(payload.sub || "") : "",
    refreshToken: tokens.refresh_token ?? null,
    idToken: tokens.id_token ?? null,
  };
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const d = await getDiscovery();
  if (!d.revocation_endpoint) return;
  await fetch(d.revocation_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: refreshToken,
      token_type_hint: "refresh_token",
      client_id: OIDC.clientId,
      client_secret: OIDC.clientSecret,
    }),
  });
}

/** Where to send the browser so the SSO session ends too. */
export function endSessionUrl(idToken: string | null): string | null {
  if (!discovery?.end_session_endpoint || !OIDC.postLogoutRedirectUri) return null;
  const url = new URL(discovery.end_session_endpoint);
  url.searchParams.set("post_logout_redirect_uri", OIDC.postLogoutRedirectUri);
  url.searchParams.set("client_id", OIDC.clientId);
  // With the id_token as proof, the SSO signs out without asking again.
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  return url.toString();
}
