"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { accessCodeMatches, adminStepUp, elevateSession, requireUser } from "./auth";
import { prisma } from "./db";
import { audit } from "./versions";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;

export type ElevateResult = { ok: true; until: string } | { ok: false; error: string };

/** Confirms the administrator access code for this session. Allowlisted users only; failures are throttled per user. */
export async function elevateAction(code: unknown): Promise<ElevateResult> {
  const user = await requireUser();
  if (!user.isAdmin) return { ok: false, error: "This account is not on the administrator allowlist." };
  const step = adminStepUp();
  if (step.mode === "disabled") return { ok: false, error: "Administration is disabled until ADMIN_ACCESS_CODE is configured on the server." };
  if (step.mode === "exempt") return { ok: true, until: new Date(Date.now() + step.hours * 3_600_000).toISOString() };
  const parsed = z.string().min(1).max(200).safeParse(code);
  const since = new Date(Date.now() - WINDOW_MS);
  const failures = await prisma.auditEvent.count({ where: { actor: user.email, action: "admin.elevate_failed", at: { gte: since } } });
  if (failures >= MAX_FAILURES) return { ok: false, error: "Too many incorrect codes. Try again in 15 minutes." };
  if (!parsed.success || !accessCodeMatches(parsed.data)) {
    await audit(prisma, user.email, "admin.elevate_failed", {});
    return { ok: false, error: `Incorrect access code (${MAX_FAILURES - failures - 1} attempts left).` };
  }
  const until = await elevateSession(user.sessionId);
  await audit(prisma, user.email, "admin.elevated", {}, { hours: step.hours });
  revalidatePath("/", "layout");
  return { ok: true, until: until.toISOString() };
}

/** Ends administrator mode for this session without signing out. */
export async function dropElevationAction(): Promise<{ ok: true }> {
  const user = await requireUser();
  await prisma.authSession.update({ where: { id: user.sessionId }, data: { elevatedUntil: null } });
  revalidatePath("/", "layout");
  return { ok: true };
}
