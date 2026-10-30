/** Pure sign-in rules (no I/O), shared by the login action, scripts and tests. */

export const LEGACY_USER_ID = "legacy-local-user";
export const SESSION_COOKIE = "pmle_session";

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const RESERVED_TLDS = new Set(["invalid", "localhost", "test", "example", "local"]);

export function normalizeEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export function parseList(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(/[\s,;]+/)
    .map((v) => v.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** null = not configured, "*" = any domain (explicit opt-in), otherwise the exact allowed domains. */
export type AllowedDomains = string[] | "*" | null;

export function parseAllowedDomains(value: string | undefined | null): AllowedDomains {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (v === "*") return "*";
  return parseList(v);
}

export type LoginCheck = { ok: true; email: string } | { ok: false; reason: string };

export function checkLoginEmail(raw: string, opts: { allowedDomains: AllowedDomains; production: boolean }): LoginCheck {
  const email = normalizeEmail(raw);
  if (!email) return { ok: false, reason: "Enter your company email address." };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, reason: "That doesn't look like a valid email address." };
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (RESERVED_TLDS.has(domain.split(".").pop()!)) return { ok: false, reason: "Use your company email address." };
  const allowed = opts.allowedDomains;
  if (allowed === null) {
    if (opts.production) return { ok: false, reason: "Sign-in is not configured yet. An administrator must set ALLOWED_EMAIL_DOMAINS." };
    return { ok: true, email };
  }
  if (allowed === "*" || allowed.includes(domain)) return { ok: true, email };
  return { ok: false, reason: `Use your company email address (${allowed.map((d) => `@${d}`).join(" or ")}).` };
}

/** Only same-origin absolute paths are allowed as post-login destinations. */
export function safeNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string" || next.length > 500) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/api/")) return "/";
  return next;
}

export function sessionTtlDays(value: string | undefined | null): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.min(365, Math.floor(n)) : 30;
}
