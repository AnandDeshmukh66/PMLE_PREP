import { BookOpenCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { authConfig, getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/auth-rules";

export const metadata = { title: "Sign in · PMLE Prep" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null);
  if (await getCurrentUser()) redirect(next);
  const { allowedDomains, production } = authConfig();
  const notice = sp.expired ? "Your session expired. Sign in again to continue — unsaved changes on this device will be saved." : sp.signedOut ? "You have been signed out." : null;
  const hint = Array.isArray(allowedDomains) ? `Use your ${allowedDomains.map((d) => `@${d}`).join(" or ")} email address.` : "Use your company email address.";
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-2 shadow-[0_4px_14px_-4px_rgb(107_140_255/0.6)]">
            <BookOpenCheck className="size-5 text-white" strokeWidth={2} />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-fg">PMLE Prep</div>
            <div className="text-[11px] text-faint">Professional Machine Learning Engineer</div>
          </div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
          <h1 className="text-[17px] font-semibold text-fg">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted">{hint} Your progress is saved to your account and restored on any device.</p>
          {notice && (
            <div role="status" className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2" data-testid="login-notice">
              {notice}
            </div>
          )}
          {production && allowedDomains === null ? (
            <div role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-[12.5px] text-bad">
              Sign-in is not configured. An administrator must set <code>ALLOWED_EMAIL_DOMAINS</code>.
            </div>
          ) : (
            <LoginForm next={next} />
          )}
        </div>
      </div>
    </div>
  );
}
