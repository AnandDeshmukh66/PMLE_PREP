"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useKeyStatus } from "@/lib/sync-client";
import { cn } from "@/lib/utils";

/**
 * Debounces text edits into `save`, and flushes immediately on blur, unmount and page hide so a
 * refresh or tab close right after typing never loses the last keystrokes (the outbox persists them).
 */
export function useDebouncedSave<T>(save: (v: T) => void, delay = 800) {
  const saveRef = useRef(save);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ v: T } | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    saveRef.current = save;
  });
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const l = latest.current;
    latest.current = null;
    if (l) saveRef.current(l.v);
    setDirty(false);
  }, []);
  const schedule = useCallback(
    (v: T) => {
      latest.current = { v };
      setDirty(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush],
  );
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    latest.current = null;
    setDirty(false);
  }, []);
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, [flush]);
  return { schedule, flush, cancel, dirty };
}

/** Inline per-field status next to an autosaved input. */
export function FieldStatus({ syncKey, dirty, className }: { syncKey: string; dirty: boolean; className?: string }) {
  const s = useKeyStatus(syncKey);
  const base = cn("inline-flex items-center gap-1 text-[10.5px]", className);
  if (s === "error")
    return (
      <span className={cn(base, "text-bad")} data-testid="field-status" data-state="error">
        <AlertTriangle className="size-3" /> Not saved
      </span>
    );
  if (dirty || s === "saving")
    return (
      <span className={cn(base, "text-faint")} data-testid="field-status" data-state="saving">
        <Loader2 className="size-3 animate-spin" /> Saving…
      </span>
    );
  if (s !== "saved") return null;
  return (
    <span className={cn(base, "text-faint")} data-testid="field-status" data-state="saved">
      <Check className="size-3 text-ok" /> Saved
    </span>
  );
}
