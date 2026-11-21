import "server-only";
import { adminStepUp, type CurrentUser, getCurrentUser } from "./auth";

const json = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

/** Route-handler guard: the signed-in user, or a 401/403 response to return as-is. */
export async function apiUser(opts: { admin?: boolean } = {}): Promise<CurrentUser | Response> {
  const user = await getCurrentUser();
  if (!user) return json(401, "Sign in required.");
  if (opts.admin && !user.isAdmin) return json(403, "Administrator access required.");
  if (opts.admin && !user.canManageContent) return json(403, adminStepUp().mode === "disabled" ? "Administration is disabled until ADMIN_ACCESS_CODE is configured on the server." : "Confirm your administrator access code first (Settings → Administrator access).");
  return user;
}

/** Rejects cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
export function sameOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host === host) return null;
  } catch {
    /* fall through */
  }
  return json(403, "Cross-site request rejected.");
}

export function attachmentName(prefix: string, email: string, ext: string): string {
  const who = email.split("@")[0].replace(/[^a-z0-9._-]/gi, "").slice(0, 40) || "user";
  return `${prefix}-${who}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}
