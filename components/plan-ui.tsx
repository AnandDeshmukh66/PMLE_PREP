"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { BookOpen, Check, ClipboardCheck, Coffee, ListChecks, Timer } from "lucide-react";
import type { PlanTask } from "@/lib/plan";
import { enqueue, hasPending, type KeyEvent, useKeyEvents, useServerState } from "@/lib/sync-client";
import { cn } from "@/lib/utils";
import { FieldStatus, useDebouncedSave } from "./autosave";

const ICON = { practice: ListChecks, theory: BookOpen, mock: Timer, review: ClipboardCheck, rest: Coffee } as const;

export function ExamDateForm({ examDate, dailyHours, compact }: { examDate: string | null; dailyHours: number; compact?: boolean }) {
  const [d, setD] = useState(examDate ?? "");
  const [h, setH] = useState(dailyHours);
  const saveHours = useCallback((v: number) => enqueue("settings", "settings", { patch: { dailyHours: v } }), []);
  const { schedule, flush, dirty } = useDebouncedSave(saveHours, 600);
  return (
    <div className={cn("flex flex-wrap items-end gap-2", compact && "text-xs")}>
      <label className="text-xs text-fg-2">
        Exam date
        <input
          type="date"
          value={d}
          onChange={(e) => {
            setD(e.target.value);
            if (!e.target.value || /^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) enqueue("settings", "settings", { patch: { examDate: e.target.value || null } });
          }}
          className="mt-1 block h-9 rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-fg outline-none [color-scheme:dark] focus-visible:border-accent"
          data-testid="exam-date"
        />
      </label>
      <label className="text-xs text-fg-2">
        Study hours per day
        <input
          type="number"
          min={1}
          max={14}
          step={0.5}
          value={h}
          onChange={(e) => {
            const v = Math.max(1, Math.min(14, Number(e.target.value) || 1));
            setH(v);
            schedule(v);
          }}
          onBlur={flush}
          className="mt-1 block h-9 w-28 rounded-lg border border-line bg-surface-2 px-2.5 text-sm text-fg outline-none focus-visible:border-accent"
        />
      </label>
      <FieldStatus syncKey="settings" dirty={dirty} className="mb-2.5" />
    </div>
  );
}

export function TaskList({ date, tasks, doneKeys, disabled }: { date: string; tasks: PlanTask[]; doneKeys: string[]; disabled?: boolean }) {
  const [done, setDoneKeys] = useServerState(doneKeys, (local, server) => [
    ...server.filter((k) => !hasPending(`task:${date}:${k}`) || local.includes(k)),
    ...local.filter((k) => !server.includes(k) && hasPending(`task:${date}:${k}`)),
  ]);
  const setDone = (key: string, on: boolean) => {
    setDoneKeys((s) => (on ? [...new Set([...s, key])] : s.filter((k) => k !== key)));
    enqueue("task", `task:${date}:${key}`, { date, taskKey: key, done: on });
  };
  return (
    <ul className="flex flex-col gap-1.5">
      {tasks.map((t) => {
        const Icon = ICON[t.kind];
        const isDone = done.includes(t.key);
        return (
          <li key={t.key} className={cn("group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors", isDone ? "border-ok/20 bg-ok-soft/30" : "border-line bg-surface-2/40")} data-testid="plan-task">
            <TaskStale syncKey={`task:${date}:${t.key}`} onStale={(on) => setDoneKeys((s) => (on ? [...new Set([...s, t.key])] : s.filter((k) => k !== t.key)))} />
            <button
              type="button"
              role="checkbox"
              aria-checked={isDone}
              aria-label={`Mark "${t.title}" ${isDone ? "not done" : "done"}`}
              disabled={disabled}
              onClick={() => setDone(t.key, !isDone)}
              className={cn("mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border", isDone ? "border-ok bg-ok text-bg" : "border-line-2 hover:border-accent")}
            >
              {isDone && <Check className="size-3" strokeWidth={3} />}
            </button>
            <Icon className="mt-0.5 size-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <div className={cn("text-[13px] font-medium", isDone ? "text-muted line-through" : "text-fg")}>
                {t.href ? (
                  <Link href={t.href} className="hover:text-accent">
                    {t.title}
                  </Link>
                ) : (
                  t.title
                )}
              </div>
              <div className="text-xs text-muted">{t.detail}</div>
            </div>
            <span className="shrink-0 text-[11px] text-faint tabular-nums">{t.minutes} min</span>
          </li>
        );
      })}
    </ul>
  );
}

function TaskStale({ syncKey, onStale }: { syncKey: string; onStale: (done: boolean) => void }) {
  useKeyEvents(
    syncKey,
    useCallback((e: KeyEvent) => e.type === "stale" && onStale((e.current as { done: boolean }).done), [onStale]),
  );
  return null;
}
