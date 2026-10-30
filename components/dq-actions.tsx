"use client";

import { useState, useTransition } from "react";
import { Check, Undo2, X } from "lucide-react";
import { decideDuplicate, resolveAnswer, setIssueStatus, setManualClassification } from "@/lib/actions";
import { callServer } from "@/lib/call-server";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

export function DuplicateButtons({ pairKey, status, previousStatus }: { pairKey: string; status: string; previousStatus: string | null }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const run = (action: "approve" | "reject" | "undo") =>
    start(async () => {
      const res = await callServer(() => decideDuplicate(pairKey, action));
      const r = res.ok ? res.value : null;
      setMsg(!res.ok ? res.error : r ? `Rebuilt: ${r.merged} merged, ${r.created} split` : null);
    });
  const merged = status === "approved" || status === "auto_confirmed";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant={merged ? "subtle" : "secondary"} disabled={pending || status === "approved"} onClick={() => run("approve")} data-testid={`dup-approve-${pairKey}`}>
        <Check className="size-3.5" /> Same question
      </Button>
      <Button size="sm" variant={!merged ? "subtle" : "secondary"} disabled={pending || status === "rejected"} onClick={() => run("reject")} data-testid={`dup-reject-${pairKey}`}>
        <X className="size-3.5" /> Different
      </Button>
      {previousStatus && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("undo")} data-testid={`dup-undo-${pairKey}`}>
          <Undo2 className="size-3.5" /> Undo
        </Button>
      )}
      {pending && <span className="text-[11px] text-muted">Rebuilding canonical questions…</span>}
      {msg && !pending && <span className="text-[11px] text-faint">{msg}</span>}
    </div>
  );
}

export function AnswerResolver({ questionId, labels, current, hasOverride }: { questionId: number; labels: string[]; current: string[] | null; hasOverride: boolean }) {
  const [sel, setSel] = useState<string[]>(current ?? []);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (labels: string[] | null, why?: string) =>
    start(async () => {
      const r = await callServer(() => resolveAnswer(questionId, labels, why));
      setErr(r.ok ? null : r.error);
    });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setSel((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l].sort()))}
          className={cn("size-7 rounded-md border text-xs font-semibold", sel.includes(l) ? "border-ok/60 bg-ok-soft text-ok" : "border-line text-muted hover:text-fg")}
          aria-pressed={sel.includes(l)}
        >
          {l}
        </button>
      ))}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" className="h-7 w-44 rounded-md border border-line bg-surface-2 px-2 text-xs outline-none focus-visible:border-accent" />
      <Button size="sm" variant="primary" disabled={!sel.length || pending} onClick={() => run(sel, note || undefined)} data-testid={`resolve-${questionId}`}>
        Set answer
      </Button>
      {hasOverride && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(null)}>
          <Undo2 className="size-3.5" /> Clear my answer
        </Button>
      )}
      {err && <span className="text-[11px] text-bad">{err}</span>}
    </div>
  );
}

export function IssueButtons({ issueKey, status }: { issueKey: string; status: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (next: "open" | "resolved" | "ignored", note?: string) =>
    start(async () => {
      const r = await callServer(() => setIssueStatus(issueKey, next, note));
      setErr(r.ok ? null : r.error);
    });
  const error = err && <span className="text-[11px] text-bad">{err}</span>;
  if (status !== "open")
    return (
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("open")}>
          <Undo2 className="size-3.5" /> Reopen
        </Button>
        {error}
      </div>
    );
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="subtle" disabled={pending} onClick={() => run("resolved", "Reviewed")} data-testid={`issue-resolve-${issueKey}`}>
        Resolve
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("ignored", "Ignored")}>
        Ignore
      </Button>
      {error}
    </div>
  );
}

export function ClassificationPicker({ questionId, current, objectives }: { questionId: number; current: string | null; objectives: { code: string; title: string }[] }) {
  const [v, setV] = useState(current ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-1.5">
      <select value={v} onChange={(e) => setV(e.target.value)} className="h-7 max-w-56 rounded-md border border-line bg-surface-2 px-1.5 text-xs outline-none">
        <option value="">Choose objective</option>
        {objectives.map((o) => (
          <option key={o.code} value={o.code}>
            {o.code} {o.title.slice(0, 40)}
          </option>
        ))}
      </select>
      <Button size="sm" variant="subtle" disabled={!v || pending || v === current} onClick={() =>
          start(async () => {
            const r = await callServer(() => setManualClassification(questionId, v));
            setErr(r.ok ? null : r.error);
          })
        }
      >
        Save
      </Button>
      {err && <span className="text-[11px] text-bad">{err}</span>}
    </div>
  );
}
