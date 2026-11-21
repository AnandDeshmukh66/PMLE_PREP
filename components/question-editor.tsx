"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { setOccurrenceExcluded } from "@/lib/actions";
import { callServer } from "@/lib/call-server";
import { editQuestionAction } from "@/lib/content-actions";
import { cn } from "@/lib/utils";
import { Button } from "./ui";

type Option = { label: string; text: string };
const field = "w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-fg outline-none focus-visible:border-accent";
const LETTERS = "ABCDEFGHIJKL";

/** Inline editor for a draft question: stem, options (re-lettered in order), correct answer(s) and explanation. */
export function QuestionEditor({ questionId, code, stem, options, answer, explanation }: { questionId: number; code: string; stem: string; options: Option[]; answer: string[]; explanation: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(stem);
  const [opts, setOpts] = useState(options.map((o) => ({ from: o.label as string | null, text: o.text })));
  const [ans, setAns] = useState<number[]>(answer.map((l) => options.findIndex((o) => o.label === l)).filter((i) => i >= 0));
  const [expl, setExpl] = useState(explanation ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const problems = [s.trim().length < 10 && "The question text must be at least 10 characters.", opts.length < 2 && "Keep at least two options.", opts.some((o) => !o.text.trim()) && "Fill in or remove empty options."].filter(Boolean) as string[];
  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await editQuestionAction({ questionId, stem: s, options: opts, answer: ans.map((i) => LETTERS[i]), explanation: expl.trim() || null }).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Please try again." }));
      if (!r.ok) return setMsg({ tone: "bad", text: r.error });
      setMsg({ tone: "ok", text: r.message });
      setOpen(false);
      router.refresh();
    });

  if (!open)
    return (
      <span className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid={`edit-${code}`}>
          <Pencil className="size-3.5" /> Edit
        </Button>
        {msg && <span className={cn("text-[11px]", msg.tone === "ok" ? "text-ok" : "text-bad")}>{msg.text}</span>}
      </span>
    );

  return (
    <div className="mt-2 w-full rounded-lg border border-accent/40 bg-surface-2/40 p-3" data-testid={`editor-${code}`}>
      <label className="mb-2 block text-[11px] text-muted">
        Question text
        <textarea className={cn(field, "mt-1 h-24")} value={s} onChange={(e) => setS(e.target.value)} maxLength={20_000} data-testid="edit-stem" />
      </label>
      <div className="mb-1 text-[11px] text-muted">Options (tick the correct answer)</div>
      <ul className="mb-2 space-y-1.5">
        {opts.map((o, i) => (
          <li key={i} className="flex items-center gap-2">
            <input type="checkbox" checked={ans.includes(i)} onChange={() => setAns((a) => (a.includes(i) ? a.filter((x) => x !== i) : [...a, i].sort()))} aria-label={`Option ${LETTERS[i]} is correct`} data-testid={`edit-correct-${LETTERS[i]}`} />
            <span className="w-4 text-xs font-semibold text-fg-2">{LETTERS[i]}.</span>
            <input className={field} value={o.text} onChange={(e) => setOpts((p) => p.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} maxLength={5_000} data-testid={`edit-option-${LETTERS[i]}`} />
            <Button
              size="sm"
              variant="ghost"
              title="Remove option"
              disabled={opts.length <= 2}
              onClick={() => {
                setOpts((p) => p.filter((_, j) => j !== i));
                setAns((a) => a.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      {opts.length < 12 && (
        <Button size="sm" variant="ghost" className="mb-2" onClick={() => setOpts((p) => [...p, { from: null, text: "" }])}>
          <Plus className="size-3.5" /> Add option
        </Button>
      )}
      <label className="mb-2 block text-[11px] text-muted">
        Explanation (optional)
        <textarea className={cn(field, "mt-1 h-16")} value={expl} onChange={(e) => setExpl(e.target.value)} maxLength={20_000} />
      </label>
      <p className="mb-2 text-[11px] text-faint">Saved to this draft only. The original extracted text is kept for provenance, and re-processing the source will not overwrite your edit. A changed answer is recorded as your reviewed answer.</p>
      {problems.length > 0 && <p className="mb-2 text-[11px] text-warn">{problems[0]}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={pending || problems.length > 0} onClick={save} data-testid="edit-save">
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {msg && <span className={cn("text-[11px]", msg.tone === "ok" ? "text-ok" : "text-bad")} role={msg.tone === "bad" ? "alert" : "status"}>{msg.text}</span>}
      </div>
    </div>
  );
}

export function ExcludeToggle({ versionId, sourceKey, excluded }: { versionId: string; sourceKey: string; excluded: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        className="text-[11px] text-muted underline-offset-2 hover:text-fg-2 hover:underline disabled:opacity-40"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await callServer(() => setOccurrenceExcluded(versionId, sourceKey, !excluded));
            setErr(r.ok ? null : r.error);
            if (r.ok) router.refresh();
          })
        }
        data-testid={`${excluded ? "restore" : "exclude"}-${sourceKey}`}
      >
        {pending ? "…" : excluded ? "Restore" : "Exclude"}
      </button>
      {err && <span className="text-[11px] text-bad">{err}</span>}
    </span>
  );
}
