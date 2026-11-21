import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { parseAllowedDomains, parseList, SESSION_COOKIE, sessionTtlDays } from "./auth-rules";
import { prisma } from "./db";

export type CurrentUser = {
  id: string;
  email: string;
  /** On the ADMIN_EMAILS allowlist. Email alone is identification, not proof, so this grants nothing by itself. */
  isAdmin: boolean;
  /** This session confirmed the administrator access code (or step-up is exempt, see adminStepUp()). */
  elevated: boolean;
  /** May change shared content: allowlisted and elevated. */
  canManageContent: boolean;
  sessionId: string;
};

export function authConfig() {
  return {
    allowedDomains: parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS),
    adminEmails: parseList(process.env.ADMIN_EMAILS),
    sessionDays: sessionTtlDays(process.env.SESSION_TTL_DAYS),
    production: process.env.NODE_ENV === "production",
  };
}

/**
 * Administrator step-up policy. With ADMIN_ACCESS_CODE set, an allowlisted user must enter it once per session
 * before changing shared content. Without it, development builds allow allowlisted users through (and say so in
 * the UI), while production fails closed: nobody can administer content until the code is configured.
 */
export function adminStepUp(): { mode: "code" | "exempt" | "disabled"; hours: number } {
  const hours = Math.min(24, Math.max(1, Number(process.env.ADMIN_ELEVATION_HOURS) || 8));
  if ((process.env.ADMIN_ACCESS_CODE ?? "").trim().length >= 8) return { mode: "code", hours };
  return { mode: authConfig().production ? "disabled" : "exempt", hours };
}

export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Constant-time comparison of a submitted access code with ADMIN_ACCESS_CODE. */
export function accessCodeMatches(submitted: string): boolean {
  const expected = (process.env.ADMIN_ACCESS_CODE ?? "").trim();
  if (expected.length < 8) return false;
  const a = crypto.createHash("sha256").update(submitted.trim()).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Secure cookies need HTTPS; plain-http localhost (local `npm run start`) must still work. */
export async function cookieSecure(): Promise<boolean> {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim();
  if (proto) return proto === "https";
  const host = (h.get("host") ?? "").replace(/:\d+$/, "");
  return !(host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost"));
}

export async function startSession(userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const { sessionDays } = authConfig();
  const expiresAt = new Date(Date.now() + sessionDays * 86_400_000);
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await prisma.authSession.create({ data: { tokenHash: hashToken(token), userId, expiresAt, userAgent } });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: await cookieSecure(), path: "/", expires: expiresAt });
}

const SLIDE_AFTER_MS = 12 * 3_600_000;

/** The signed-in user for this request, resolved from the session cookie against the database (memoized per request). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const s = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { id: true, email: true } } } });
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt.getTime() <= now) {
    await prisma.authSession.deleteMany({ where: { id: s.id } });
    return null;
  }
  if (now - s.lastUsedAt.getTime() > SLIDE_AFTER_MS) {
    const { sessionDays } = authConfig();
    await prisma.authSession.updateMany({ where: { id: s.id }, data: { lastUsedAt: new Date(now), expiresAt: new Date(now + sessionDays * 86_400_000) } });
  }
  const isAdmin = authConfig().adminEmails.includes(s.user.email);
  const step = adminStepUp().mode;
  const elevated = isAdmin && (step === "exempt" || (step === "code" && !!s.elevatedUntil && s.elevatedUntil.getTime() > now));
  return { id: s.user.id, email: s.user.email, isAdmin, elevated, canManageContent: isAdmin && elevated, sessionId: s.id };
});

/** For pages and non-autosave server actions: redirects to the login page when there is no valid session. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const path = (await headers()).get("x-pmle-path") ?? "/";
    redirect(`/login?expired=1&next=${encodeURIComponent(path)}`);
  }
  return user;
}

export class ForbiddenError extends Error {
  constructor(message = "Only administrators can change shared certification content.") {
    super(message);
  }
}

/** Shared-content changes: allowlisted email and a session confirmed with the administrator access code. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new ForbiddenError();
  if (!user.canManageContent) {
    throw new ForbiddenError(
      adminStepUp().mode === "disabled"
        ? "Administration is disabled until ADMIN_ACCESS_CODE is configured on the server."
        : "Confirm your administrator access code first (Settings → Administrator access).",
    );
  }
  return user;
}

export async function elevateSession(sessionId: string): Promise<Date> {
  const until = new Date(Date.now() + adminStepUp().hours * 3_600_000);
  await prisma.authSession.update({ where: { id: sessionId }, data: { elevatedUntil: until } });
  return until;
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: await cookieSecure(), path: "/", maxAge: 0 });
}
