"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Play, Search } from "lucide-react";
import { createPracticeSession } from "@/lib/actions";
import { callServer } from "@/lib/call-server";
import { PRACTICE_MODES, type PracticeMode } from "@/lib/selection";
import { cn, DOMAIN_SHORT } from "@/lib/utils";
import { Button, Card, CardHeader } from "./ui";

type Init = { mode: PracticeMode; count: number; domains: number[]; concepts: string[]; shuffle: boolean; immediateFeedback: boolean };

export function PracticeConfigForm({
  initial,
  counts,
  domains,
  concepts,
}: {
  initial: Init;
  counts: Record<PracticeMode, number>;
  domains: { number: number; title: string; count: number }[];
  concepts: { id: string; name: string; domain: number; count: number }[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<PracticeMode>(initial.mode);
  const [count, setCount] = useState(initial.count);
  const [doms, setDoms] = useState<number[]>(initial.domains);
  const [cons, setCons] = useState<string[]>(initial.concepts);
  const [shuffle, setShuffle] = useState(initial.shuffle);
  const [feedback, setFeedback] = useState(initial.immediateFeedback);
  const [includeAttempted, setIncludeAttempted] = useState(true);
  const [includeUnverified, setIncludeUnverified] = useState(true);
  const [conceptQuery, setConceptQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const visibleConcepts = useMemo(() => {
    const q = conceptQuery.toLowerCase();
    return concepts.filter((c) => c.count > 0 && (!q || c.name.toLowerCase().includes(q)) && (!doms.length || doms.includes(c.domain)));
  }, [conceptQuery, concepts, doms]);

  const needsDomain = mode === "domain" && !doms.length;
  const needsTopic = mode === "topic" && !cons.length;

  const startSession = () => {
    setMsg(null);
    start(async () => {
      const res = await callServer(() => createPracticeSession({ mode, count, shuffle, immediateFeedback: feedback, includeAttempted, includeUnverified, domains: doms, concepts: mode === "topic" ? cons : undefined }));
      if (!res.ok) return setMsg(res.error);
      const r = res.value;
      if (!r.id) setMsg(r.note ?? "No questions match this configuration.");
      else router.push(`/practice/${r.id}`);
    });
  };

  const chip = (on: boolean) => cn("rounded-lg border px-2.5 py-1.5 text-xs transition-colors", on ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted hover:border-line-2 hover:text-fg-2");

  return (
    <Card>
      <CardHeader title="New session" subtitle="Choose a mode, then refine" />
      <div className="grid gap-2 px-5 sm:grid-cols-2 lg:grid-cols-5">
        {(Object.keys(PRACTICE_MODES) as PracticeMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            data-testid={`mode-${m}`}
            className={cn("rounded-xl border p-3 text-left transition-colors", mode === m ? "border-accent/60 bg-accent-soft" : "border-line bg-surface-2/40 hover:border-line-2")}
          >
            <div className="flex items-center justify-between text-[13px] font-medium text-fg">
              {PRACTICE_MODES[m].title}
              {m !== "weak_area" && <span className="text-[11px] font-normal text-faint tabular-nums">{counts[m]}</span>}
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-muted">{PRACTICE_MODES[m].description}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-6 px-5 pt-5 pb-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-fg-2">Domains {mode === "domain" ? "(required)" : "(optional filter)"}</div>
            <div className="flex flex-wrap gap-1.5">
              {domains.map((d) => (
                <button key={d.number} type="button" className={chip(doms.includes(d.number))} onClick={() => setDoms((s) => (s.includes(d.number) ? s.filter((x) => x !== d.number) : [...s, d.number]))} data-testid={`domain-${d.number}`}>
                  {d.number} · {DOMAIN_SHORT[d.number]} <span className="text-faint">{d.count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-fg-2">
              Questions
              <input type="number" min={1} max={200} value={count} onChange={(e) => setCount(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} className="mt-1 h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus-visible:border-accent" data-testid="count" />
            </label>
            <div className="flex flex-col justify-end gap-1.5 text-xs text-fg-2">
              <Toggle label="Shuffle order" on={shuffle} set={setShuffle} />
              <Toggle label="Immediate feedback" on={feedback} set={setFeedback} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5 text-xs text-fg-2">
            <Toggle label="Include previously attempted questions" on={includeAttempted} set={setIncludeAttempted} />
            <Toggle label="Include questions without a verified answer (recorded, not graded)" on={includeUnverified} set={setIncludeUnverified} />
          </div>
        </div>
        <div className={cn(mode !== "topic" && "opacity-50")}>
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-fg-2">
            Topics {mode === "topic" ? `(${cons.length} selected)` : "(topic mode only)"}
            {cons.length > 0 && (
              <button type="button" className="text-[11px] text-muted hover:text-fg" onClick={() => setCons([])}>
                Clear
              </button>
            )}
          </div>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-faint" />
            <input value={conceptQuery} onChange={(e) => setConceptQuery(e.target.value)} disabled={mode !== "topic"} placeholder="Filter topics" className="h-8 w-full rounded-lg border border-line bg-surface-2 pr-2 pl-8 text-xs outline-none focus-visible:border-accent" />
          </div>
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto pr-1">
            {visibleConcepts.map((c) => (
              <button key={c.id} type="button" disabled={mode !== "topic"} className={chip(cons.includes(c.id))} onClick={() => setCons((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}>
                {c.name} <span className="text-faint">{c.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
        <Button variant="primary" onClick={startSession} disabled={pending || needsDomain || needsTopic} data-testid="start-practice">
          <Play className="size-3.5" /> {pending ? "Building…" : "Start practice"}
        </Button>
        {needsDomain && <span className="text-xs text-warn">Select at least one domain.</span>}
        {needsTopic && <span className="text-xs text-warn">Select at least one topic.</span>}
        {msg && <span className="text-xs text-warn">{msg}</span>}
      </div>
    </Card>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="size-3.5 accent-[var(--color-accent)]" />
      {label}
    </label>
  );
}
