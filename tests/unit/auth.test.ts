import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { checkLoginEmail, parseAllowedDomains, safeNext, sessionTtlDays } from "@/lib/auth-rules";
import { libpqUrl } from "@/lib/backup";

describe("login email rules", () => {
  const acme = { allowedDomains: parseAllowedDomains("acme.com, @acme.co.uk"), production: true };
  it("accepts company emails, normalised", () => {
    expect(checkLoginEmail("  Jane.Doe@ACME.com ", acme)).toEqual({ ok: true, email: "jane.doe@acme.com" });
    expect(checkLoginEmail("j@acme.co.uk", acme)).toMatchObject({ ok: true });
  });
  it("rejects other domains, look-alikes and malformed input", () => {
    for (const e of ["j@gmail.com", "j@acme.com.evil.io", "j@sub.acme.com", "j@acme", "", "a b@acme.com", "@acme.com", `${"x".repeat(250)}@acme.com`]) expect(checkLoginEmail(e, acme).ok, e).toBe(false);
  });
  it("requires explicit configuration in production but not in development", () => {
    expect(checkLoginEmail("j@any.org", { allowedDomains: null, production: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/ALLOWED_EMAIL_DOMAINS/) });
    expect(checkLoginEmail("j@any.org", { allowedDomains: null, production: false })).toMatchObject({ ok: true });
    expect(checkLoginEmail("j@any.org", { allowedDomains: "*", production: true })).toMatchObject({ ok: true });
    expect(checkLoginEmail("j@example.test", { allowedDomains: "*", production: true }).ok).toBe(false);
  });
  it("only allows local post-login redirects", () => {
    expect(safeNext("/mock/abc?x=1")).toBe("/mock/abc?x=1");
    for (const n of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "/login", "/login?next=/", "/api/me/backup", "/x\r\nSet-Cookie: a=b", null, undefined]) expect(safeNext(n), String(n)).toBe("/");
  });
  it("bounds the session lifetime", () => {
    expect(sessionTtlDays(undefined)).toBe(30);
    expect(sessionTtlDays("7")).toBe(7);
    expect(sessionTtlDays("0")).toBe(30);
    expect(sessionTtlDays("100000")).toBe(365);
  });
});

describe("route protection (proxy)", () => {
  const req = (path: string, init: { cookie?: string; headers?: Record<string, string>; method?: string } = {}) =>
    new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers: { ...(init.cookie ? { cookie: `pmle_session=${init.cookie}` } : {}), ...init.headers } });

  it("sends signed-out visitors to the login page, keeping where they were going", () => {
    const r = proxy(req("/questions/Q-0001?from=all"));
    expect(r.status).toBe(307);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/questions/Q-0001?from=all");
  });
  it("answers APIs with 401 instead of a redirect", async () => {
    const r = proxy(req("/api/me/backup"));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Sign in required." });
  });
  it("leaves the login page and health check public", () => {
    expect(proxy(req("/login")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("/api/health")).headers.get("x-middleware-next")).toBe("1");
  });
  it("passes requests with a session cookie through (verified later against the database) and sets security headers", () => {
    const r = proxy(req("/settings", { cookie: "abc" }));
    expect(r.headers.get("x-middleware-next")).toBe("1");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.cookies.get("pmle_session")?.httpOnly).toBe(true);
  });
});

describe("pg_dump connection string", () => {
  it("drops Prisma-only parameters libpq rejects", () => {
    expect(libpqUrl("postgresql://u:p@db.example.com:5432/pmle?schema=public&connection_limit=5&sslmode=require")).toBe("postgresql://u:p@db.example.com:5432/pmle?sslmode=require");
  });
});
