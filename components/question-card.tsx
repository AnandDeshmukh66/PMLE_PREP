"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, CircleHelp, ExternalLink, Eye, FileText, Info, XCircle } from "lucide-react";
import { submitAnswer, type SubmitResult } from "@/lib/actions";
import { enqueue, type KeyEvent, newClientId, useKeyEvents } from "@/lib/sync-client";
import { LEGACY_LABEL } from "@/lib/filters";
import type { QuestionCardData } from "@/lib/question-data";
import { cn, DOMAIN_SHORT } from "@/lib/utils";
import { VERIFICATION_HELP, VERIFICATION_LABEL, type Verification } from "@/lib/verification";
import { AlignmentBadge, DomainBadge, LegacyBadge, VerificationBadge } from "./badges";
import { Badge, Button, Card, Kbd } from "./ui";

const CLAIM_LABEL: Record<string, string> = {
  pdf_key: "PDF answer key",
  examprepper_answer: "ExamPrepper answer",
  examtopics_key: "ExamTopics original key",
  community_vote: "Community vote (top)",
  user_override: "Your resolution",
};

export function StemText({ stem, images }: { stem: string; images: { remote: string; local: string | null }[] }) {
  const parts = stem.split(/(\[\[img:\d+\]\])/g);
  return (
    <div className="prose-q text-[15px] text-fg">
      {parts.map((p, i) => {
        const m = /\[\[img:(\d+)\]\]/.exec(p);
        if (!m) return <span key={i}>{p}</span>;
        const img = images[Number(m[1])];
        if (!img) return <span key={i} className="text-warn">[exhibit unavailable]</span>;
        return (
          <span key={i} className="my-3 block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.local ?? img.remote} alt={`Exhibit ${Number(m[1]) + 1}`} className="max-h-[520px] max-w-full rounded-lg border border-line bg-white/95 p-1" />
          </span>
        );
      })}
    </div>
  );
}

const SUBMIT_TIMEOUT_MS = 12_000;

type Props = {
  data: QuestionCardData;
  sessionId?: string | null;
  immediateFeedback?: boolean;
  keyboard?: boolean;
  prevHref?: string | null;
  nextHref?: string | null;
  onAnswered?: (r: SubmitResult) => void;
  onNext?: () => void;
  onPrev?: () => void;
  initialSelected?: string[] | null;
  initialResult?: Pick<SubmitResult, "outcome" | "provisionalOutcome"> | null;
};

export function QuestionCard({ data, sessionId, immediateFeedback = true, keyboard = true, prevHref, nextHref, onAnswered, onNext, onPrev, initialSelected, initialResult }: Props) {
  const [selected, setSelected] = useState<string[]>(initialSelected ?? []);
  const [result, setResult] = useState<Pick<SubmitResult, "outcome" | "provisionalOutcome"> | null>(initialResult ?? null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [pending, setPending] = useState(false);
  const started = useRef<number>(0);
  const attemptId = useRef<string | null>(null);
  const [clientId, setClientId] = useState("");
  useEffect(() => {
    started.current = Date.now();
    attemptId.current = null;
  }, [data.id]);

  const accept = useCallback(
    (r: SubmitResult) => {
      setQueued(false);
      setError(null);
      setResult(r);
      onAnswered?.(r);
    },
    [onAnswered],
  );
  useKeyEvents(
    `answer:${clientId}`,
    useCallback(
      (e: KeyEvent) => {
        if (e.type === "saved") accept(e.result as unknown as SubmitResult);
        else if (e.type === "failed") {
          setQueued(false);
          setError(e.error);
        }
      },
      [accept],
    ),
  );

  const submitted = !!result;
  const showAnswer = (submitted && immediateFeedback) || revealed;
  const multi = data.multiSelect;

  const toggle = useCallback(
    (label: string) => {
      if (submitted || queued) return;
      setSelected((s) => (multi ? (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]) : [label]));
    },
    [multi, queued, submitted],
  );

  const submit = useCallback(() => {
    if (!selected.length || submitted || queued) return;
    setError(null);
    const id = (attemptId.current ??= newClientId());
    setClientId(id);
    const input = { clientId: id, questionId: data.id, selected, sessionId, elapsedMs: Date.now() - started.current };
    const keep = (msg: string) => {
      enqueue("answer", `answer:${id}`, input);
      setQueued(true);
      setError(msg);
    };
    // The attempt's clientId makes resends idempotent, so a slow request can be handed to the outbox safely.
    let settled = false;
    const settle = () => {
      const first = !settled;
      settled = true;
      clearTimeout(slow);
      setPending(false);
      return first;
    };
    const slow = setTimeout(() => settle() && keep("The server is slow to respond. Your answer is kept and will be saved automatically."), SUBMIT_TIMEOUT_MS);
    setPending(true);
    submitAnswer(input).then(
      (r) => {
        const first = settle();
        if (r.ok) accept(r);
        else if (!first) return;
        else if (r.code === "UNAUTHENTICATED") keep("Your session expired. Your answer is kept on this device and will be saved after you sign in again.");
        else setError(r.error);
      },
      () => settle() && keep("Couldn't reach the server. Your answer is kept and will be saved automatically when the connection returns."),
    );
  }, [accept, data.id, queued, selected, sessionId, submitted]);

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const idx = "abcdefgh".indexOf(k);
      const num = Number(k) - 1;
      const opt = idx >= 0 && idx < data.options.length ? data.options[idx] : num >= 0 && num < data.options.length ? data.options[num] : null;
      if (opt) {
        e.preventDefault();
        toggle(opt.label);
      } else if (k === "enter") {
        e.preventDefault();
        if (!submitted) submit();
        else if (onNext) onNext();
        else if (nextHref) window.location.assign(nextHref);
      } else if (k === "arrowright" || k === "n") {
        if (onNext) onNext();
        else if (nextHref) window.location.assign(nextHref);
      } else if (k === "arrowleft" || k === "p") {
        if (onPrev) onPrev();
        else if (prevHref) window.location.assign(prevHref);
      } else if (k === "r" && !submitted) setRevealed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data.options, keyboard, nextHref, onNext, onPrev, prevHref, submit, submitted, toggle]);

  const key = data.correctLabels;
  const prov = data.provisionalLabels;
  const outcome = result?.outcome ?? null;

  const optionState = (label: string) => {
    const isSel = selected.includes(label);
    if (!showAnswer) return isSel ? "selected" : "idle";
    if (data.gradable && key) {
      if (key.includes(label)) return isSel ? "correct-picked" : "correct-missed";
      return isSel ? "wrong" : "idle";
    }
    if (prov?.includes(label)) return isSel ? "prov-picked" : "prov";
    return isSel ? "selected-ungraded" : "idle";
  };

  return (
    <Card className="overflow-hidden" data-testid="question-card">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-3">
        <span className="font-mono text-xs font-semibold text-fg">{data.code}</span>
        <DomainBadge domain={data.domainNumber} objective={data.objective?.code} />
        <AlignmentBadge score={data.alignmentScore} band={data.alignmentBand} />
        <VerificationBadge status={data.verification} />
        <LegacyBadge status={data.legacyStatus} />
        {multi && <Badge tone="violet">Choose {data.selectCount}</Badge>}
        <span className="ml-auto text-[11px] text-faint">{data.subtopic}</span>
      </div>
      <div className="px-5 pt-5 pb-4">
        {!data.active && data.mergedIntoCode && (
          <div className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
            This canonical question was merged into <Link className="underline" href={`/questions/${data.mergedIntoCode}`}>{data.mergedIntoCode}</Link>.
          </div>
        )}
        <StemText stem={data.stem} images={data.images} />
        <div className="mt-5 flex flex-col gap-2" role={multi ? "group" : "radiogroup"} aria-label="Answer options">
          {data.options.map((o, i) => {
            const st = optionState(o.label);
            return (
              <button
                key={o.label}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={selected.includes(o.label)}
                disabled={submitted}
                onClick={() => toggle(o.label)}
                data-testid={`option-${o.label}`}
                data-state={st}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all",
                  st === "idle" && "border-line bg-surface-2/60 hover:border-line-2 hover:bg-surface-2",
                  st === "selected" && "border-accent/60 bg-accent-soft",
                  st === "correct-picked" && "border-ok/60 bg-ok-soft",
                  st === "correct-missed" && "border-ok/50 border-dashed bg-ok-soft/40",
                  st === "wrong" && "border-bad/60 bg-bad-soft",
                  (st === "prov" || st === "prov-picked") && "border-warn/50 bg-warn-soft/60",
                  st === "selected-ungraded" && "border-accent-2/50 bg-violet-soft",
                  submitted && "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "mt-px flex size-6 shrink-0 items-center justify-center text-[11px] font-semibold",
                    multi ? "rounded-md" : "rounded-full",
                    st === "idle" ? "bg-white/[0.06] text-muted" : "bg-white/10 text-fg",
                    st === "selected" && "bg-accent text-white",
                  )}
                >
                  {o.label}
                </span>
                <span className="prose-q flex-1 text-[13.5px] text-fg-2">{o.text}</span>
                {st === "correct-picked" && <CheckCircle2 className="size-4 shrink-0 text-ok" />}
                {st === "correct-missed" && <span className="shrink-0 text-[10.5px] text-ok">correct</span>}
                {st === "wrong" && <XCircle className="size-4 shrink-0 text-bad" />}
                {(st === "prov" || st === "prov-picked") && <span className="shrink-0 text-[10.5px] text-warn">provisional</span>}
                <span className="sr-only">Shortcut {i + 1}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!submitted && (
            <>
              <Button variant="primary" onClick={submit} disabled={!selected.length || pending || queued} data-testid="submit-answer">
                {pending ? "Saving…" : queued ? "Waiting to save…" : immediateFeedback ? "Submit answer" : "Save answer"}
              </Button>
              {!revealed && immediateFeedback && (
                <Button variant="ghost" onClick={() => setRevealed(true)} data-testid="reveal-answer">
                  <Eye className="size-3.5" /> Reveal answer
                </Button>
              )}
              {multi && <span className="text-xs text-muted">Select {data.selectCount} options ({selected.length} selected)</span>}
            </>
          )}
          {submitted && (onNext || nextHref) && (
            <Button variant="secondary" onClick={() => (onNext ? onNext() : nextHref && window.location.assign(nextHref))} data-testid="next-question">
              Next question <Kbd>↵</Kbd>
            </Button>
          )}
          {keyboard && (
            <span className="ml-auto hidden items-center gap-1 text-[11px] text-faint md:flex">
              <Kbd>A</Kbd>–<Kbd>{data.options[data.options.length - 1]?.label}</Kbd> select · <Kbd>↵</Kbd> submit · <Kbd>←</Kbd>
              <Kbd>→</Kbd> navigate · <Kbd>R</Kbd> reveal
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className={cn("mt-2 text-xs", queued ? "text-warn" : "text-bad")} data-testid="answer-error">
            {error}
          </p>
        )}
      </div>

      {submitted && !immediateFeedback && !revealed && (
        <div className="border-t border-line bg-white/[0.015] px-5 py-3 text-xs text-muted" data-testid="answer-saved">
          Answer saved. Feedback is hidden in this session and shown in the session summary.
        </div>
      )}

      {showAnswer && (
        <div className="animate-in border-t border-line bg-white/[0.015] px-5 py-4" data-testid="feedback">
          {submitted && outcome && <OutcomeBanner outcome={outcome} provisionalOutcome={result?.provisionalOutcome ?? null} gradable={data.gradable} selectCount={data.selectCount} selected={selected} keyLabels={key} />}
          {revealed && !submitted && <div className="mb-3 text-xs text-muted">Answer revealed before submitting.</div>}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Answer</div>
              {data.gradable && key ? (
                <div className="text-sm text-fg">
                  Correct answer: <span className="font-semibold text-ok">{key.join(", ")}</span>
                </div>
              ) : (
                <div className="text-sm text-warn">
                  {VERIFICATION_LABEL[data.verification as Verification]}: no definitive answer. {prov && <>Provisional (best-supported claim): <span className="font-semibold">{prov.join(", ")}</span></>}
                </div>
              )}
              {data.verificationNote && <p className="mt-1 text-xs text-muted">{data.verificationNote}</p>}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Answer claims by source</div>
              <ul className="space-y-1 text-xs">
                {data.claims.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-1.5 text-fg-2">
                    <span className="text-muted">{CLAIM_LABEL[c.kind] ?? c.kind}:</span>
                    <span className="font-semibold">{c.labels.join(", ") || "-"}</span>
                    {c.percent !== null && <span className="text-faint">({c.percent}%)</span>}
                    {c.sourceLabels.join("") !== c.labels.join("") && <span className="text-faint">source letters {c.sourceLabels.join(", ")}</span>}
                    {c.incomplete && <Badge tone="warn">incomplete in PDF</Badge>}
                    {c.unmappable && <Badge tone="warn">unmappable</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Explanations data={data} />
        </div>
      )}
      <MetadataPanel data={data} />
    </Card>
  );
}

function OutcomeBanner({ outcome, provisionalOutcome, gradable, selectCount, selected, keyLabels }: { outcome: string; provisionalOutcome: string | null; gradable: boolean; selectCount: number; selected: string[]; keyLabels: string[] | null }) {
  if (!gradable || outcome === "ungraded") {
    return (
      <div className="mb-4 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-warn" data-testid="outcome-ungraded">
        <CircleHelp className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium">Answer recorded, not graded</div>
          <div className="text-xs opacity-90">
            This answer is not verified, so no definitive judgment is given.{" "}
            {provisionalOutcome === "correct" ? "Your choice matches the provisional answer." : provisionalOutcome ? "Your choice differs from the provisional answer." : ""}
          </div>
        </div>
      </div>
    );
  }
  if (outcome === "correct")
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2.5 text-sm font-medium text-ok" data-testid="outcome-correct">
        <CheckCircle2 className="size-4" /> Correct
      </div>
    );
  if (outcome === "partial")
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-sm text-warn" data-testid="outcome-partial">
        <CircleAlert className="size-4" /> Partially matched: {selected.filter((s) => keyLabels?.includes(s)).length} of {selectCount} correct options selected. Counted as incorrect.
      </div>
    );
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-sm font-medium text-bad" data-testid="outcome-incorrect">
      <XCircle className="size-4" /> Incorrect
    </div>
  );
}

function Explanations({ data }: { data: QuestionCardData }) {
  const source = data.explanations.filter((e) => e.kind === "source");
  const community = data.explanations.filter((e) => e.kind === "community");
  return (
    <div className="mt-4 space-y-3">
      {source.map((e, i) => (
        <div key={i}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">Source explanation</div>
          <p className="prose-q text-[13px] text-fg-2">{e.content}</p>
        </div>
      ))}
      {!source.length && <p className="text-xs text-faint">Neither source provides an explanation. None has been generated, to avoid presenting unverified reasoning as fact.</p>}
      {community.length > 0 && (
        <details className="group rounded-lg border border-line bg-surface-2/40">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted hover:text-fg-2">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            Community discussion ({community.length}), unverified opinions from ExamPrepper
          </summary>
          <div className="space-y-2.5 px-3 pb-3">
            {community.map((c, i) => (
              <div key={i} className="rounded-md bg-white/[0.02] px-3 py-2">
                <div className="mb-1 text-[10.5px] text-faint">▲ {c.upvotes ?? 0} upvotes</div>
                <p className="prose-q text-xs text-fg-2">{c.content}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function MetadataPanel({ data, defaultOpen = false }: { data: QuestionCardData; defaultOpen?: boolean }) {
  const legacy = data.legacyNotes;
  const conf = useMemo(() => ({ high: "High", medium: "Medium", low: "Low" })[data.classificationConfidence] ?? data.classificationConfidence, [data.classificationConfidence]);
  return (
    <details className="group border-t border-line" open={defaultOpen} data-testid="metadata-panel">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-2.5 text-xs text-muted hover:text-fg-2">
        <Info className="size-3.5" />
        Source & classification
        <span className="text-faint">· {data.occurrences.map((o) => `${o.source === "pdf" ? "PDF" : "EP"} Q${o.qnum}`).join(" · ")}</span>
        <ChevronDown className="ml-auto size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="grid gap-5 px-5 pt-1 pb-5 text-xs md:grid-cols-3">
        <div>
          <div className="mb-1.5 font-semibold text-fg-2">Sources</div>
          <ul className="space-y-1.5">
            {data.occurrences.map((o) => (
              <li key={o.key} className="text-fg-2">
                {o.source === "pdf" ? (
                  <a className="inline-flex items-center gap-1 hover:text-accent" href={`/api/pdf#page=${o.page ?? 1}`} target="_blank" rel="noreferrer">
                    <FileText className="size-3.5" /> PDF · Question {o.qnum} · Page {o.page}
                    {o.pageEnd && o.pageEnd !== o.page ? `–${o.pageEnd}` : ""}
                  </a>
                ) : (
                  <a className="inline-flex items-center gap-1 hover:text-accent" href={o.url ?? "#"} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" /> ExamPrepper · Question {o.qnum} · Page {o.url?.split("/").pop()}
                  </a>
                )}
                {o.topicLabel && <div className="pl-5 text-faint">{o.topicLabel}</div>}
                {o.issues.length > 0 && <div className="pl-5 text-warn">{o.issues.join(", ").replaceAll("_", " ")}</div>}
              </li>
            ))}
          </ul>
          <div className="mt-3 mb-1 font-semibold text-fg-2">Answer verification</div>
          <div className="text-fg-2">{VERIFICATION_LABEL[data.verification as Verification]}</div>
          <div className="text-faint">{VERIFICATION_HELP[data.verification as Verification]}</div>
        </div>
        <div>
          <div className="mb-1.5 font-semibold text-fg-2">Classification</div>
          {data.domainNumber ? (
            <dl className="space-y-1 text-fg-2">
              <div>
                <dt className="inline text-faint">Domain </dt>
                <dd className="inline">
                  {data.domainNumber} · {DOMAIN_SHORT[data.domainNumber]}
                </dd>
              </div>
              {data.objective && (
                <div>
                  <dt className="inline text-faint">Objective </dt>
                  <dd className="inline">
                    <Link className="hover:text-accent" href={`/questions?objective=${data.objective.code}`}>
                      {data.objective.code}
                    </Link>{" "}
                    {data.objective.title}
                  </dd>
                </div>
              )}
              {data.secondaryObjectives.length > 0 && (
                <div>
                  <dt className="inline text-faint">Secondary </dt>
                  <dd className="inline">{data.secondaryObjectives.join(", ")}</dd>
                </div>
              )}
              <div>
                <dt className="inline text-faint">Topic </dt>
                <dd className="inline">
                  {data.topic} → {data.subtopic}
                </dd>
              </div>
              <div>
                <dt className="inline text-faint">Confidence </dt>
                <dd className="inline">
                  {conf} ({data.classificationConfidenceValue.toFixed(2)}){data.classificationStatus === "manual" ? " · manual" : ""}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="text-warn">Unmapped: no guide objective matched automatically.</div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {data.concepts.map((c) => (
              <Link key={c.id} href={`/theory/${c.id}`} className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[11px] text-fg-2 hover:bg-violet-soft hover:text-accent-2">
                {c.name}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 font-semibold text-fg-2">Alignment</div>
          <div className="text-fg-2">
            Score {data.alignmentScore.toFixed(2)} · {data.alignmentBand}
          </div>
          <p className="mt-1 text-faint">{data.classificationExplanation}</p>
          {data.classificationEvidence && <p className="mt-1.5 border-l-2 border-line-2 pl-2 text-muted italic">Guide: “{data.classificationEvidence}”</p>}
          <div className="mt-3 mb-1 font-semibold text-fg-2">Status</div>
          <div className="text-fg-2">{LEGACY_LABEL[data.legacyStatus] ?? data.legacyStatus}</div>
          {legacy.length > 0 && (
            <ul className="mt-1 space-y-1">
              {legacy.map((l, i) => (
                <li key={i} className="text-faint">
                  <span className={l.severity >= 1 ? "text-warn" : "text-muted"}>{l.term}</span>: {l.modern}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
}
