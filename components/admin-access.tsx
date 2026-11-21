"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { dropElevationAction, elevateAction } from "@/lib/admin-actions";
import { Button, Card, CardHeader } from "./ui";

export function AdminAccessCard({ mode, elevated, until, hours }: { mode: "code" | "exempt" | "disabled"; elevated: boolean; until: string | null; hours: number }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card id="admin-access">
      <CardHeader title="Administrator access" subtitle="Needed to add certifications, import content and publish versions" />
      <div className="space-y-3 px-5 pb-5 text-xs">
        {mode === "disabled" && (
          <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-bad" data-testid="admin-disabled">
            Administration is turned off on this server because <code>ADMIN_ACCESS_CODE</code> is not set. Your email is on the allowlist, but an email address alone does not prove who is signed in.
          </p>
        )}
        {mode === "exempt" && (
          <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-warn" data-testid="admin-exempt">
            Development mode: <code>ADMIN_ACCESS_CODE</code> is not set, so allowlisted accounts can administer without a code. Production builds refuse administration until the code is configured.
          </p>
        )}
        {mode === "code" && elevated && (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-ok" data-testid="admin-elevated">
              <ShieldCheck className="size-4" /> Administrator mode is on{until ? ` until ${new Date(until).toLocaleString()}` : ""}.
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await dropElevationAction();
                  router.refresh();
                })
              }
            >
              <ShieldOff className="size-3.5" /> Turn off
            </Button>
          </div>
        )}
        {mode === "code" && !elevated && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await elevateAction(code);
                setCode("");
                setErr(r.ok ? null : r.error);
                if (r.ok) router.refresh();
              });
            }}
          >
            <label className="sr-only" htmlFor="admin-code">
              Administrator access code
            </label>
            <input
              id="admin-code"
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Access code"
              className="h-8 w-56 rounded-lg border border-line bg-surface-2 px-2.5 text-xs text-fg outline-none focus-visible:border-accent"
              data-testid="admin-code"
            />
            <Button size="sm" variant="primary" type="submit" disabled={!code || pending} data-testid="admin-elevate">
              Confirm
            </Button>
            <span className="text-faint">Valid for {hours} hours in this browser session.</span>
          </form>
        )}
        {err && (
          <p role="alert" className="text-bad">
            {err}
          </p>
        )}
      </div>
    </Card>
  );
}
