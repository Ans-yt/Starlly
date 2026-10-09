import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { AppDatabase } from "../db/client.js";
import { appAuth } from "../db/schema.js";

const SESSION_COOKIE = "starlly_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function hmac(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export function createSessionToken(secret: string, ttlMs = SESSION_TTL_MS): string {
  const exp = (Date.now() + ttlMs).toString();
  return `${exp}.${hmac(exp, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || exp < Date.now()) return false;
  return safeEqualHex(hmac(expStr, secret), sig);
}

export type AuthRow = typeof appAuth.$inferSelect;

export function getAuthRow(db: AppDatabase): AuthRow | undefined {
  return db.select().from(appAuth).where(eq(appAuth.id, 1)).get();
}

/**
 * Owner-route guard. First-run setup mode: before a password exists the API is
 * open (onboarding must be reachable); once configured, a valid session is
 * required everywhere except /api/public/*, /api/auth/*, /api/health.
 */
export function requireOwner(db: AppDatabase) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = getAuthRow(db);
    if (!auth) {
      next(); // setup mode
      return;
    }
    if (verifySessionToken(req.cookies?.[SESSION_COOKIE], auth.sessionSecret)) {
      next();
      return;
    }
    res.status(401).json({ error: "authentication_required" });
  };
}

export function setSessionCookie(res: Response, db: AppDatabase): void {
  const auth = getAuthRow(db);
  if (!auth) throw new Error("Not configured");
  res.cookie(SESSION_COOKIE, createSessionToken(auth.sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // behind an HTTPS tunnel the proxy terminates TLS; keep the cookie portable for localhost preview
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function isConfigured(db: AppDatabase): boolean {
  return getAuthRow(db) !== undefined;
}
