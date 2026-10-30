"use server";

import { Prisma } from "@prisma/client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authConfig, endSession, startSession } from "./auth";
import { checkLoginEmail, safeNext } from "./auth-rules";
import { prisma } from "./db";

export type LoginState = { error: string | null; email: string };

const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 30;
const attemptsByIp = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (attemptsByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attemptsByIp.set(ip, recent);
  if (attemptsByIp.size > 10_000) attemptsByIp.clear();
  return recent.length > MAX_ATTEMPTS;
}

async function findOrCreateUser(email: string) {
  try {
    return await prisma.user.upsert({ where: { email }, create: { email }, update: { lastLoginAt: new Date() } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return prisma.user.findUniqueOrThrow({ where: { email } });
    throw e;
  }
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const raw = String(form.get("email") ?? "").slice(0, 320);
  const next = safeNext(String(form.get("next") ?? ""));
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
  if (rateLimited(ip)) return { error: "Too many sign-in attempts. Wait a few minutes and try again.", email: raw };
  const cfg = authConfig();
  const check = checkLoginEmail(raw, cfg);
  if (!check.ok) return { error: check.reason, email: raw };
  const user = await findOrCreateUser(check.email);
  await startSession(user.id);
  await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login?signedOut=1");
}
