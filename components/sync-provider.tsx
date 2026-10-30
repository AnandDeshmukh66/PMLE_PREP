"use client";

import { AlertTriangle, Check, CloudOff, Loader2, LogIn } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { dismissFailures, enqueue, hasPending, initSync, onRemoteSave, startSync, useSyncStatus } from "@/lib/sync-client";
import { cn } from "@/lib/utils";

const RESUMABLE = /^\/(questions\/[^/]+|practice\/[^/]+|mock\/[^/]+|theory(\/[^/]+)?)$/;

/** Boots the per-user outbox, keeps other tabs fresh, and remembers where the user was for "Continue". */
export function SyncProvider({ userId, sessionKey, children }: { userId: string; sessionKey: string; children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  initSync(userId, sessionKey);

  useEffect(() => {
    startSync();
  }, [userId, sessionKey]);

  useEffect(() => {
    let last = 0;
    const refresh = () => {
      if (hasPending() || Date.now() - last < 2000) return;
      last = Date.now();
      router.refresh();
    };
    const onVisible = () => document.visibilityState === "visible" && refresh();
    const off = onRemoteSave(refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  useEffect(() => {
    if (!RESUMABLE.test(path) || path === "/questions/new") return;
    const t = setTimeout(() => enqueue("location", "location", { path: path + window.location.search }), 1500);
    return () => clearTimeout(t);
  }, [path]);

  return children;
}

function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** Global save state: Saving… / All changes saved / Offline (queued) / Error / Session expired. */
export function SaveIndicator({ compact = false }: { compact?: boolean }) {
  const s = useSyncStatus();
  const path = usePathname();
  const [now, setNow] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    tick.current = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(tick.current!);
  }, [s.lastSavedAt]);

  const base = "flex items-center gap-1.5 text-[11.5px]";
  let body: React.ReactNode;
  if (s.state === "auth") {
    body = (
      <Link href={`/login?expired=1&next=${encodeURIComponent(path)}`} className={cn(base, "font-medium text-warn hover:underline")}>
        <LogIn className="size-3.5" /> {compact ? "Sign in to save" : `Session expired — sign in to save ${s.pending} change${s.pending === 1 ? "" : "s"}`}
      </Link>
    );
  } else if (s.state === "offline") {
    body = (
      <span className={cn(base, "text-warn")} title={s.message ?? undefined}>
        <CloudOff className="size-3.5" /> {compact ? `${s.pending} unsaved` : `${s.pending} change${s.pending === 1 ? "" : "s"} waiting · retrying`}
      </span>
    );
  } else if (s.state === "saving") {
    body = (
      <span className={cn(base, "text-muted")}>
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    );
  } else if (s.state === "error") {
    body = (
      <span className={cn(base, "text-bad")} title={s.message ?? undefined}>
        <AlertTriangle className="size-3.5" /> {compact ? "Save failed" : s.message}
        <button type="button" onClick={dismissFailures} className="ml-1 underline">
          Dismiss
        </button>
      </span>
    );
  } else if (s.state === "saved" && s.lastSavedAt) {
    body = (
      <span className={cn(base, "text-faint")}>
        <Check className="size-3.5 text-ok" /> {compact ? "Saved" : `All changes saved · ${ago(s.lastSavedAt, now || s.lastSavedAt)}`}
      </span>
    );
  } else {
    body = (
      <span className={cn(base, "text-faint")}>
        <Check className="size-3.5" /> {compact ? "Synced" : "Progress saves automatically"}
      </span>
    );
  }
  return (
    <div role="status" aria-live="polite" data-testid="save-indicator" data-state={s.state}>
      {body}
    </div>
  );
}
