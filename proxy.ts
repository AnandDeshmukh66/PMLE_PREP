import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionTtlDays } from "./lib/auth-rules";

const PUBLIC_PATHS = ["/login", "/api/health"];

/**
 * Optimistic gate only: requests without a session cookie never reach portal pages or APIs.
 * The cookie is fully verified against the database in lib/auth.ts for every page, action and API.
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const isAction = req.headers.has("next-action");

  if (!token && !isPublic && !isAction) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  const forwarded = new Headers(req.headers);
  forwarded.set("x-pmle-path", pathname + search);
  const res = NextResponse.next({ request: { headers: forwarded } });

  if (token && !isAction && req.method === "GET" && !pathname.startsWith("/api/")) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? req.nextUrl.protocol.replace(":", "");
    const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : proto === "https";
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: sessionTtlDays(process.env.SESSION_TTL_DAYS) * 86_400 });
  }
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "same-origin");
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
