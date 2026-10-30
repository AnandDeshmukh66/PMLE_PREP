"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useEffect } from "react";
import { buttonClass } from "@/components/ui";
import { type LoginState, loginAction } from "@/lib/auth-actions";
import { resetSync } from "@/lib/sync-client";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { error: null, email: "" });
  // Arriving here means signed out or expired: detach the previous account's in-memory outbox (its unsent changes stay in localStorage).
  useEffect(() => resetSync(), []);
  return (
    <form action={action} className="mt-5 flex flex-col gap-3" noValidate>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="text-[12px] font-medium text-fg-2">
        Work email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoFocus
        required
        defaultValue={state.email}
        placeholder="name@company.com"
        aria-invalid={!!state.error}
        aria-describedby={state.error ? "login-error" : undefined}
        className="h-10 rounded-lg border border-line-2 bg-surface-2 px-3 text-[14px] text-fg outline-none placeholder:text-faint focus:border-accent"
        data-testid="login-email"
      />
      {state.error && (
        <p id="login-error" role="alert" className="text-[12.5px] text-bad" data-testid="login-error">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className={buttonClass("primary", "md", "mt-1 h-10 justify-center")} data-testid="login-submit">
        {pending && <Loader2 className="size-4 animate-spin" />} Continue
      </button>
    </form>
  );
}
