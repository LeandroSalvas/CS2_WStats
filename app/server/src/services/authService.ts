import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { appPublicUrl, env, publicBasePath } from "../config/env.js";

// ---------------------------------------------------------------------------
// Sessão: JWT assinado (HMAC-SHA256) em cookie httpOnly. Stateless de propósito
// — sobrevive a restarts do Postgres e não precisa de session store.
// ---------------------------------------------------------------------------

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 dias
export const SESSION_COOKIE = "wstats_session";

interface SessionPayload {
  uid: number;
  email: string;
  role: "PENDENTE" | "ADMIN" | "SUPER_ADMIN";
  isLocalAdmin?: boolean;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Segredo efêmero caso AUTH_JWT_SECRET não esteja definido (com aviso). */
const ephemeralSecret = crypto.randomBytes(32).toString("hex");
if (!env.AUTH_JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    "[auth] AUTH_JWT_SECRET ausente — usando segredo efêmero; sessões expirarão a cada restart.",
  );
}
const jwtSecret = () => env.AUTH_JWT_SECRET ?? ephemeralSecret;

export function signSession(payload: Omit<SessionPayload, "iat" | "exp">): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + SESSION_TTL_SECONDS,
    }),
  );
  const sig = crypto
    .createHmac("sha256", jwtSecret())
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifySession(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", jwtSecret())
    .update(`${header}.${body}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload & {
      exp: number;
    };
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      uid: payload.uid,
      email: payload.email,
      role: payload.role,
      isLocalAdmin: payload.isLocalAdmin,
    };
  } catch {
    return null;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const secure = appPublicUrlIsHttps();
  const path = publicBasePath() || "/";
  reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=${token}; Path=${path}; HttpOnly; SameSite=Lax${
      secure ? "; Secure" : ""
    }; Max-Age=${SESSION_TTL_SECONDS}`,
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  const secure = appPublicUrlIsHttps();
  const path = publicBasePath() || "/";
  reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=; Path=${path}; HttpOnly; SameSite=Lax${
      secure ? "; Secure" : ""
    }; Max-Age=0`,
  );
}

function appPublicUrlIsHttps(): boolean {
  try {
    return new URL(appPublicUrl()).protocol === "https:";
  } catch {
    return false;
  }
}

export function readSession(req: FastifyRequest): SessionPayload | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE && rest.length > 0) {
      return verifySession(rest.join("="));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Senhas locais: scrypt nativo (sem dependências externas).
// Formato: scrypt$N$r$p$saltHex$hashHex
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(nStr),
      r: Number(rStr),
      p: Number(pStr),
    });
    return (
      expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Estado anti-CSRF do fluxo OAuth do Google.
// ---------------------------------------------------------------------------

const OAUTH_STATE_COOKIE = "wstats_oauth_state";

export function makeOAuthState(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function setOAuthStateCookie(reply: FastifyReply, state: string): void {
  const secure = appPublicUrlIsHttps();
  const path = publicBasePath() || "/";
  reply.header(
    "set-cookie",
    `${OAUTH_STATE_COOKIE}=${state}; Path=${path}; HttpOnly; SameSite=Lax${
      secure ? "; Secure" : ""
    }; Max-Age=600`,
  );
}

export function readOAuthStateCookie(req: FastifyRequest): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === OAUTH_STATE_COOKIE && rest.length > 0) return rest.join("=");
  }
  return null;
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  const path = publicBasePath() || "/";
  reply.header("set-cookie", `${OAUTH_STATE_COOKIE}=; Path=${path}; HttpOnly; Max-Age=0`);
}
