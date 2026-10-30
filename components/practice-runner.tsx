"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Flag as FlagIcon, Square } from "lucide-react";
import { abandonSession, finishPracticeSession, type SubmitResult } from "@/lib/actions";
import { callServer } from "@/lib/call-server";
import { enqueue, flush } from "@/lib/sync-client";
import type { QuestionCardData } from "@/lib/question-data";
import { cn } from "@/lib/utils";
import { QuestionCard } from "./question-card";
import { QuestionSide } from "./question-side";
import { Button } from "./ui";

type PaletteItem = { code: string; outcome: "correct" | "incorrect" | "partial" | "ungraded" | "answered" | null };

export function PracticeRunner(props: {
  sessionId: string;
  index: number;
  total: number;
  immediateFeedback: boolean;
  keyboard: boolean;
  data: QuestionCardData;
  palette: PaletteItem[];
  initialSelected: string[] | null;
  initialResult: Pick<SubmitResult, "outcome" | "provisionalOutcome"> | null;
}) {
  const { sessionId, index, total, palette } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    enqueue("sessionIndex", `index:${sessionId}`, { sessionId, index });
  }, [sessionId, index]);

  const go = (i: number) => router.push(`/practice/${sessionId}?i=${i}`);
  const finish = () =>
    start(async () => {
      setError(null);
      if (!(await flush(10_000))) {
        setError("Some answers haven't reached the server yet. They are kept on this device; finish again once you're back online.");
        return;
      }
      const r = await callServer(() => finishPracticeSession(sessionId));
      if (!r.ok) return setError(r.error);
      router.push(`/practice/${sessionId}?summary=1`);
    });
  const abandon = () =>
    start(async () => {
      setError(null);
      const r = await callServer(() => abandonSession(sessionId));
      if (!r.ok) return setError(r.error);
      router.push("/practice");
    });
  const next = () => (index < total - 1 ? go(index + 1) : finish());
  const unanswered = palette.filter((p) => !p.outcome).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1" aria-label="Question palette" data-testid="palette">
        {palette.map((p, i) => (
          <button
            key={p.code}
            type="button"
            onClick={() => go(i)}
            aria-label={`Question ${i + 1}${p.outcome ? `, ${p.outcome}` : ""}`}
            aria-current={i === index}
            className={cn(
              "size-7 rounded-md text-[11px] font-medium tabular-nums transition-colors",
              i === index && "ring-2 ring-accent ring-offset-1 ring-offset-bg",
              !p.outcome && "bg-white/[0.05] text-muted hover:bg-white/10",
              p.outcome === "correct" && "bg-ok-soft text-ok",
              (p.outcome === "incorrect" || p.outcome === "partial") && "bg-bad-soft text-bad",
              p.outcome === "ungraded" && "bg-violet-soft text-accent-2",
              p.outcome === "answered" && "bg-accent-soft text-accent",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted" data-testid="session-position">
          Question {index + 1} of {total}
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => go(index - 1)}>
            <ChevronLeft className="size-3.5" /> Previous
          </Button>
          <Button size="sm" variant="ghost" disabled={index >= total - 1} onClick={() => go(index + 1)}>
            Skip <ChevronRight className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => (unanswered === 0 || confirm(`${unanswered} question${unanswered === 1 ? "" : "s"} unanswered. Finish anyway?`)) && finish()}
            data-testid="finish-session"
          >
            <FlagIcon className="size-3.5" /> Finish
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              confirm("Abandon this session? Answers already submitted stay in your history.") && abandon()
            }
          >
            <Square className="size-3.5" /> Abandon
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-bad" data-testid="session-error">
          {error}
        </p>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <QuestionCard
          data={props.data}
          sessionId={sessionId}
          immediateFeedback={props.immediateFeedback}
          keyboard={props.keyboard}
          initialSelected={props.initialSelected}
          initialResult={props.initialResult}
          onNext={next}
          onPrev={index > 0 ? () => go(index - 1) : undefined}
          onAnswered={() => {
            if (!props.immediateFeedback) setTimeout(next, 250);
          }}
        />
        <QuestionSide key={`side-${props.data.id}`} data={props.data} />
      </div>
    </div>
  );
}
