import crypto from "node:crypto";
import { type Jar, setRequestHeaders, activateJar } from "../stubs/next-headers";
import { RedirectSignal } from "../stubs/next-navigation";

export const TEST_DOMAIN = "acme-corp.com";
export const ADMIN = `admin@${TEST_DOMAIN}`;

export function configureAuthEnv() {
  process.env.ALLOWED_EMAIL_DOMAINS = TEST_DOMAIN;
  process.env.ADMIN_EMAILS = ADMIN;
}

/** Signs in through the real login action and returns that browser's cookie jar (now active). */
export async function login(email: string, next = "/"): Promise<{ jar: Jar; redirectTo: string }> {
  const jar: Jar = new Map();
  activateJar(jar);
  setRequestHeaders({ "x-forwarded-for": `10.0.${crypto.randomInt(255)}.${crypto.randomInt(255)}` });
  const { loginAction } = await import("@/lib/auth-actions");
  const fd = new FormData();
  fd.set("email", email);
  fd.set("next", next);
  try {
    const r = await loginAction({ error: null, email: "" }, fd);
    throw new Error(`Login rejected: ${r.error}`);
  } catch (e) {
    if (e instanceof RedirectSignal) return { jar, redirectTo: e.url };
    throw e;
  }
}

export function as(jar: Jar) {
  activateJar(jar);
}

let last = 0;
/** Strictly increasing client change times, like the browser outbox produces. */
export const rev = () => (last = Math.max(Date.now(), last + 1));
export const cid = () => crypto.randomUUID();

export function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`Expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}
