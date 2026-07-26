const SESSION_COOKIE = "qinbaobei_portal_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const EXPECTED_APP_ID = "qinbaobei";

export type PortalSession = {
  version: 1;
  userId: number;
  displayName: string;
  appId: typeof EXPECTED_APP_ID;
  expiresAt: number;
};

type PortalExchangeUser = {
  id: number;
  displayName: string;
};

function sessionSecret(): string {
  const value = process.env.PORTAL_SESSION_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("PORTAL_SESSION_SECRET must contain at least 32 characters");
  }
  return value;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function createPortalSessionCookie(user: PortalExchangeUser): Promise<string> {
  const session: PortalSession = {
    version: 1,
    userId: user.id,
    displayName: user.displayName,
    appId: EXPECTED_APP_ID,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payload = stringToBase64Url(JSON.stringify(session));
  const signature = await sign(payload);
  return [
    `${SESSION_COOKIE}=${payload}.${signature}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function clearPortalSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function getPortalSession(request: Request): Promise<PortalSession | null> {
  const cookie = readCookie(request, SESSION_COOKIE);
  if (!cookie) return null;

  const [payload, signature, extra] = cookie.split(".");
  if (!payload || !signature || extra) return null;

  let expectedSignature: string;
  try {
    expectedSignature = await sign(payload);
  } catch {
    return null;
  }
  if (!constantTimeEqual(signature, expectedSignature)) return null;

  try {
    const session = JSON.parse(base64UrlToString(payload)) as Partial<PortalSession>;
    if (
      session.version !== 1 ||
      session.appId !== EXPECTED_APP_ID ||
      !Number.isInteger(session.userId) ||
      typeof session.displayName !== "string" ||
      typeof session.expiresAt !== "number" ||
      session.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return session as PortalSession;
  } catch {
    return null;
  }
}

export async function requirePortalSession(request: Request): Promise<Response | null> {
  const session = await getPortalSession(request);
  if (session) return null;
  return Response.json(
    { error: "portal_login_required", message: "请从微信小程序重新获取访问链接。" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return decodeURIComponent(item.slice(separator + 1).trim());
    }
  }
  return null;
}

