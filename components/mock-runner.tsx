"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Clock, Send } from "lucide-react";
import { submitMock } from "@/lib/actions";
import { enqueue, flush, pendingEntries, useAfterMount, useSyncStatus } from "@/lib/sync-client";
import { cn, fmtClock } from "@/lib/utils";
import { StemText } from "./question-card";
import { Button, Card, Kbd } from "./ui";

export type MockQuestion = {
  id: number;
  code: string;
  stem: string;
  multiSelect: boolean;
  selectCount: number;
  options: { label: string; text: string }[];
  images: { remote: string; local: string | null }[];
  domain: number | null;
  selected: string[];
  marked: boolean;
};

export function MockRunner({
  sessionId,
  title,
  questions,
  startIndex,
  deadline,
  serverNow,
  showTimer,
  keyboard,
}: {
  sessionId: string;
  title: string;
  questions: MockQuestion[];
  startIndex: number;
  deadline: string;
  serverNow: string;
  showTimer: boolean;
  keyboard: boolean;
}) {
  const router = useRouter();
  const [index, setIndex] = useState(startIndex);
  const [answers, setAnswers] = useState<Record<number, string[]>>(() => Object.fromEntries(questions.map((q) => [q.id, q.selected])));
  const [marks, setMarks] = useState<Record<number, boolean>>(() => Object.fromEntries(questions.map((q) => [q.id, q.marked])));
  const [confirming, setConfirming] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const sync = useSyncStatus();
  const [submitting, startSubmit] = useTransition();
  const skew = useRef(0);
  const [remaining, setRemaining] = useState<number>(() => Math.max(0, Math.round((Date.parse(deadline) - Date.parse(serverNow)) / 1000)));
  const viewStart = useRef(0);
  const submittedRef = useRef(false);

  const q = questions[index];

  const saveAnswer = useCallback(
    (questionId: number, selected: string[], elapsedDeltaMs = 0) => enqueue("mockAnswer", `mock:${sessionId}:${questionId}`, { sessionId, questionId, selected, elapsedDeltaMs }),
    [sessionId],
  );

  const doSubmit = useCallback(
    (auto: boolean) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitError(null);
      startSubmit(async () => {
        const cur = questions[index];
        saveAnswer(cur.id, answers[cur.id] ?? [], Date.now() - viewStart.current);
        viewStart.current = Date.now();
        const saved = await flush(10_000);
        if (!saved && !auto) {
          submittedRef.current = false;
          setSubmitError("Some answers haven't reached the server yet. They are kept on this device; submit again once you're back online.");
          return;
        }
        try {
          await submitMock(sessionId, auto);
          router.refresh();
        } catch {
          setSubmitError("Couldn't reach the server to submit. Your answers are kept; retrying…");
          setTimeout(() => (submittedRef.current = false), 5000);
        }
      });
    },
    [answers, index, questions, router, saveAnswer, sessionId],
  );

  useAfterMount(() => {
    const pending = pendingEntries("mockAnswer").filter((p) => p.args.sessionId === sessionId);
    if (pending.length) setAnswers((a) => ({ ...a, ...Object.fromEntries(pending.map((p) => [p.args.questionId, p.args.selected])) }));
  }, [sessionId]);

  useEffect(() => {
    skew.current = Date.parse(serverNow) - Date.now();
    viewStart.current = Date.now();
  }, [serverNow]);

  useEffect(() => {
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((Date.parse(deadline) - (Date.now() + skew.current)) / 1000));
      setRemaining(left);
      if (left <= 0) doSubmit(true);
    }, 500);
    return () => clearInterval(t);
  }, [deadline, doSubmit]);

  const goto = useCallback(
    (i: number) => {
      if (i < 0 || i >= questions.length || i === index) return;
      const delta = Date.now() - viewStart.current;
      viewStart.current = Date.now();
      const cur = questions[index];
      saveAnswer(cur.id, answers[cur.id] ?? [], delta);
      enqueue("sessionIndex", `index:${sessionId}`, { sessionId, index: i });
      setIndex(i);
    },
    [answers, index, questions, saveAnswer, sessionId],
  );

  const choose = useCallback(
    (label: string) => {
      const cur = questions[index];
      const prev = answers[cur.id] ?? [];
      const next = cur.multiSelect ? (prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label].sort()) : prev[0] === label ? [] : [label];
      setAnswers((a) => ({ ...a, [cur.id]: next }));
      saveAnswer(cur.id, next);
    },
    [answers, index, questions, saveAnswer],
  );

  const toggleMark = useCallback(() => {
    const cur = questions[index];
    const on = !marks[cur.id];
    setMarks((m) => ({ ...m, [cur.id]: on }));
    enqueue("mockMark", `mark:${sessionId}:${cur.id}`, { sessionId, questionId: cur.id, marked: on });
  }, [index, marks, questions, sessionId]);

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (confirming || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      const k = e.key.toLowerCase();
      const cur = questions[index];
      const idx = "abcdefgh".indexOf(k);
      const num = Number(k) - 1;
      const opt = idx >= 0 && idx < cur.options.length ? cur.options[idx] : num >= 0 && num < cur.options.length ? cur.options[num] : null;
      if (opt) {
        e.preventDefault();
        choose(opt.label);
      } else if (k === "arrowright" || k === "n" || k === "enter") goto(index + 1);
      else if (k === "arrowleft" || k === "p") goto(index - 1);
      else if (k === "m") toggleMark();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, confirming, goto, index, keyboard, questions, toggleMark]);

  const answeredCount = questions.filter((x) => (answers[x.id] ?? []).length > 0).length;
  const markedCount = questions.filter((x) => marks[x.id]).length;
  const sel = answers[q.id] ?? [];
  const low = remaining <= 300;

  return (
    <div className="animate-in" data-testid="mock-runner">
      <div className="sticky top-0 z-20 -mx-4 -mt-6 mb-4 flex flex-wrap items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:-mt-8 lg:px-8">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{title}</div>
          <div className="text-xs text-muted" data-testid="mock-progress">
            {answeredCount} of {questions.length} answered · {markedCount} marked
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-faint" aria-live="polite">
            {sync.state === "saving" ? "Saving…" : sync.state === "offline" ? "Offline: answers kept, retrying" : sync.state === "auth" ? "Session expired: sign in to save" : sync.state === "error" ? "An answer could not be saved" : sync.lastSavedAt ? "All answers saved" : ""}
          </span>
          {showTimer && (
            <span className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-sm tabular-nums", low ? "bg-bad-soft text-bad" : "bg-white/[0.05] text-fg")} data-testid="mock-timer" aria-label="Time remaining">
              <Clock className="size-3.5" />
              {fmtClock(remaining)}
            </span>
          )}
          <Button variant="primary" size="sm" onClick={() => setConfirming(true)} disabled={submitting} data-testid="open-submit">
            <Send className="size-3.5" /> Submit exam
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-xs">
            <span className="font-semibold text-fg" data-testid="mock-position">
              Question {index + 1} of {questions.length}
            </span>
            {q.multiSelect && <span className="rounded-md bg-violet-soft px-1.5 py-0.5 text-[11px] text-accent-2">Choose {q.selectCount}</span>}
            <button type="button" onClick={toggleMark} className={cn("ml-auto flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]", marks[q.id] ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg-2")} aria-pressed={!!marks[q.id]} data-testid="mock-mark">
              <Bookmark className="size-3" /> {marks[q.id] ? "Marked for review" : "Mark for review"}
            </button>
          </div>
          <div className="px-5 py-5">
            <StemText stem={q.stem} images={q.images} />
            <div className="mt-5 flex flex-col gap-2" role={q.multiSelect ? "group" : "radiogroup"}>
              {q.options.map((o) => {
                const on = sel.includes(o.label);
                return (
                  <button
                    key={o.label}
                    type="button"
                    role={q.multiSelect ? "checkbox" : "radio"}
                    aria-checked={on}
                    onClick={() => choose(o.label)}
                    data-testid={`mock-option-${o.label}`}
                    className={cn("flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors", on ? "border-accent/60 bg-accent-soft" : "border-line bg-surface-2/60 hover:border-line-2 hover:bg-surface-2")}
                  >
                    <span className={cn("mt-px flex size-6 shrink-0 items-center justify-center text-[11px] font-semibold", q.multiSelect ? "rounded-md" : "rounded-full", on ? "bg-accent text-white" : "bg-white/[0.06] text-muted")}>{o.label}</span>
                    <span className="prose-q flex-1 text-[13.5px] text-fg-2">{o.text}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={index === 0} onClick={() => goto(index - 1)} data-testid="mock-prev">
                <ChevronLeft className="size-3.5" /> Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={index >= questions.length - 1} onClick={() => goto(index + 1)} data-testid="mock-next">
                Next <ChevronRight className="size-3.5" />
              </Button>
              {keyboard && (
                <span className="ml-auto hidden items-center gap-1 text-[11px] text-faint md:flex">
                  <Kbd>A</Kbd>–<Kbd>D</Kbd> answer · <Kbd>←</Kbd>
                  <Kbd>→</Kbd> move · <Kbd>M</Kbd> mark
                </span>
              )}
            </div>
          </div>
        </Card>

        <Card className="h-fit p-4">
          <div className="mb-2 text-xs font-medium text-fg-2">Question palette</div>
          <div className="grid grid-cols-8 gap-1 xl:grid-cols-6" data-testid="mock-palette">
            {questions.map((x, i) => {
              const done = (answers[x.id] ?? []).length > 0;
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => goto(i)}
                  aria-label={`Question ${i + 1}${done ? ", answered" : ""}${marks[x.id] ? ", marked" : ""}`}
                  className={cn(
                    "relative h-8 rounded-md text-[11px] font-medium tabular-nums",
                    done ? "bg-accent-soft text-accent" : "bg-white/[0.05] text-muted hover:bg-white/10",
                    i === index && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
                  )}
                >
                  {i + 1}
                  {marks[x.id] && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warn" />}
                </button>
              );
            })}
          </div>
          <div className="mt-3 space-y-1 text-[11px] text-muted">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm bg-accent-soft ring-1 ring-accent/40" /> Answered
            </div>
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm bg-white/[0.05]" /> Not answered
            </div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-warn" /> Marked for review
            </div>
          </div>
        </Card>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="submit-title">
          <Card className="w-full max-w-md p-6">
            <h2 id="submit-title" className="text-base font-semibold text-fg">
              Submit the mock exam?
            </h2>
            <ul className="mt-3 space-y-1 text-sm text-fg-2">
              <li>
                {answeredCount} of {questions.length} answered
              </li>
              {questions.length - answeredCount > 0 && <li className="text-warn">{questions.length - answeredCount} unanswered (scored as incorrect if the answer is verified)</li>}
              {markedCount > 0 && <li className="text-accent">{markedCount} marked for review</li>}
              <li className="text-muted">{fmtClock(remaining)} remaining</li>
            </ul>
            {submitError && (
              <p role="alert" className="mt-3 text-xs text-warn" data-testid="submit-error">
                {submitError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep working
              </Button>
              <Button variant="primary" onClick={() => doSubmit(false)} disabled={submitting} data-testid="confirm-submit">
                {submitting ? "Submitting…" : "Submit now"}
              </Button>
            </div>
          </Card>
        </div>
      )}
      {submitting && !confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 text-sm text-fg backdrop-blur-sm" data-testid="auto-submitting">
          Time is up. Submitting your exam…
        </div>
      )}
    </div>
  );
}
