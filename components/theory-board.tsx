"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, NotebookPen, Search } from "lucide-react";
import type { TheoryState } from "@/lib/actions";
import { enqueue, hasPending, type KeyEvent, useKeyEvents, useServerState } from "@/lib/sync-client";
import { cn, DOMAIN_COLOR, pct, relTime } from "@/lib/utils";
import { FieldStatus, useDebouncedSave } from "./autosave";
import { Badge, Card, ProgressBar, ProgressRing } from "./ui";

export type TheoryItem = {
  id: string;
  name: string;
  description: string;
  domain: number;
  objective: string;
  objectiveTitle: string;
  secondary: string[];
  category: string;
  priority: string;
  guideStatus: string;
  status: string;
  confidence: string | null;
  notes: string;
  updatedAt: string | null;
  questionCount: number;
  attempted: number;
  accuracy: number | null;
};

const STATUS = [
  { id: "not_started", label: "Not started" },
  { id: "in_progress", label: "In progress" },
  { id: "completed", label: "Completed" },
] as const;

type Patch = { id: string; status?: string; confidence?: string | null; notes?: string };
type Status = "not_started" | "in_progress" | "completed";
type Confidence = "low" | "medium" | "high";

const applyPatch = (it: TheoryItem, p: Patch, at: string | null = new Date().toISOString()): TheoryItem => ({
  ...it,
  ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)),
  updatedAt: at ?? it.updatedAt,
});

/** Saves one concept's change (merged with any still-pending change to the same concept). */
function saveTheory(p: Patch) {
  enqueue("theory", `theory:${p.id}`, {
    conceptId: p.id,
    patch: {
      ...(p.status !== undefined ? { status: p.status as Status } : {}),
      ...(p.confidence !== undefined ? { confidence: p.confidence as Confidence | null } : {}),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
    },
  });
}

export function TheoryBoard({
  items,
  domains,
  initial,
}: {
  items: TheoryItem[];
  domains: { number: number; title: string; weight: number }[];
  initial?: { domain: number | null; unfinished: boolean; high: boolean };
}) {
  const [optimistic, setItems] = useServerState(items, (local, server) => {
    const mine = new Map(local.map((it) => [it.id, it]));
    return server.map((it) => (hasPending(`theory:${it.id}`) ? (mine.get(it.id) ?? it) : it));
  });
  const [q, setQ] = useState("");
  const [domain, setDomain] = useState<number | null>(initial?.domain ?? null);
  const [unfinished, setUnfinished] = useState(initial?.unfinished ?? false);
  const [highOnly, setHighOnly] = useState(initial?.high ?? false);
  const [guide, setGuide] = useState<string>("");

  const update = useCallback((p: Patch, local = false) => {
    setItems((state) => state.map((it) => (it.id === p.id ? applyPatch(it, p, local ? null : undefined) : it)));
    if (!local) saveTheory(p);
  }, [setItems]);

  const visible = useMemo(() => {
    const s = q.toLowerCase();
    return optimistic.filter(
      (it) =>
        (!domain || it.domain === domain) &&
        (!unfinished || it.status !== "completed") &&
        (!highOnly || it.priority === "high") &&
        (!guide || it.guideStatus === guide) &&
        (!s || `${it.name} ${it.description} ${it.objective} ${it.category}`.toLowerCase().includes(s)),
    );
  }, [domain, guide, highOnly, optimistic, q, unfinished]);

  const expandAll = !!(q || unfinished || highOnly || guide || domain);
  const done = optimistic.filter((i) => i.status === "completed").length;
  const inProg = optimistic.filter((i) => i.status === "in_progress").length;
  const high = optimistic.filter((i) => i.priority === "high");
  const highDone = high.filter((i) => i.status === "completed").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-[auto_1fr]">
        <Card className="flex items-center gap-4 p-4">
          <ProgressRing value={optimistic.length ? done / optimistic.length : 0} size={64} color="var(--color-ok)">
            {pct(optimistic.length ? done / optimistic.length : 0)}
          </ProgressRing>
          <div className="text-xs">
            <div className="text-sm font-medium text-fg" data-testid="theory-overall">
              {done} of {optimistic.length} completed
            </div>
            <div className="text-muted">{inProg} in progress</div>
            <div className="text-muted">
              High priority: {highDone}/{high.length}
            </div>
          </div>
        </Card>
        <Card className="grid grid-cols-2 gap-x-5 gap-y-2.5 p-4 sm:grid-cols-3">
          {domains.map((d) => {
            const its = optimistic.filter((i) => i.domain === d.number);
            const c = its.filter((i) => i.status === "completed").length;
            return (
              <button key={d.number} type="button" onClick={() => setDomain(domain === d.number ? null : d.number)} className={cn("rounded-lg p-1.5 text-left text-xs transition-colors", domain === d.number ? "bg-white/[0.05]" : "hover:bg-white/[0.03]")} data-testid={`theory-domain-${d.number}`}>
                <div className="mb-1 flex justify-between">
                  <span className="truncate text-fg-2">
                    {d.number} · {d.title.split(" ").slice(0, 3).join(" ")}
                  </span>
                  <span className="text-muted tabular-nums">
                    {c}/{its.length}
                  </span>
                </div>
                <ProgressBar value={its.length ? c / its.length : 0} />
              </button>
            );
          })}
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search concepts" className="h-9 w-64 rounded-lg border border-line bg-surface-2 pr-3 pl-8 text-xs outline-none focus-visible:border-accent" data-testid="theory-search" />
        </div>
        <FilterChip on={unfinished} set={setUnfinished} testid="filter-unfinished">
          Unfinished only
        </FilterChip>
        <FilterChip on={highOnly} set={setHighOnly} testid="filter-high">
          High priority
        </FilterChip>
        <select value={guide} onChange={(e) => setGuide(e.target.value)} className="h-9 rounded-lg border border-line bg-surface-2 px-2 text-xs outline-none" aria-label="Guide status">
          <option value="">All guide statuses</option>
          <option value="explicit">Explicitly in guide</option>
          <option value="prerequisite">Prerequisite</option>
          <option value="supplementary">Supplementary</option>
        </select>
        {domain && (
          <button type="button" onClick={() => setDomain(null)} className="text-xs text-muted hover:text-fg">
            Clear domain filter
          </button>
        )}
        <span className="ml-auto text-xs text-faint">{visible.length} shown</span>
      </div>

      {domains
        .filter((d) => !domain || d.number === domain)
        .map((d) => {
          const its = visible.filter((i) => i.domain === d.number);
          if (!its.length) return null;
          const cats = [...new Set(its.map((i) => i.category))];
          return (
            <section key={d.number} aria-labelledby={`dom-${d.number}`}>
              <h2 id={`dom-${d.number}`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
                <span className="size-2 rounded-full" style={{ background: DOMAIN_COLOR[d.number] }} />
                Domain {d.number}: {d.title}
                <span className="font-normal text-faint">· {d.weight}%</span>
              </h2>
              <div className="flex flex-col gap-2">
                {cats.map((cat) => {
                  const ci = its.filter((i) => i.category === cat);
                  const cd = ci.filter((i) => i.status === "completed").length;
                  return (
                    <details key={cat} open={expandAll} className="group rounded-xl border border-line bg-surface/60">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2.5 text-[13px]">
                        <ChevronDown className="size-3.5 text-muted -rotate-90 transition-transform group-open:rotate-0" />
                        <span className="font-medium text-fg-2">{cat}</span>
                        <span className="text-xs text-faint">
                          {cd}/{ci.length}
                        </span>
                        <ProgressBar value={ci.length ? cd / ci.length : 0} tone="ok" className="ml-auto w-24" />
                      </summary>
                      <div className="grid gap-2.5 px-3 pb-3 md:grid-cols-2 xl:grid-cols-3">
                        {ci.map((it) => (
                          <ConceptCard key={it.id} it={it} update={update} />
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </section>
          );
        })}
      {visible.length === 0 && <p className="py-10 text-center text-sm text-muted">No concepts match these filters.</p>}
    </div>
  );
}

export function ConceptEditor({ item }: { item: TheoryItem }) {
  const [it, setIt] = useServerState(item, (local, server) => (hasPending(`theory:${server.id}`) ? local : server));
  const update = useCallback((p: Patch, local = false) => {
    setIt((s) => applyPatch(s, p, local ? null : undefined));
    if (!local) saveTheory(p);
  }, [setIt]);
  return <ConceptCard it={it} update={update} />;
}

function FilterChip({ on, set, children, testid }: { on: boolean; set: (v: boolean) => void; children: React.ReactNode; testid: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => set(!on)} data-testid={testid} className={cn("h-9 rounded-lg border px-3 text-xs transition-colors", on ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg-2")}>
      {children}
    </button>
  );
}

function ConceptCard({ it, update }: { it: TheoryItem; update: (p: Patch, local?: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(it.notes);
  const key = `theory:${it.id}`;
  const saveNotes = useCallback((v: string) => update({ id: it.id, notes: v }), [it.id, update]);
  const { schedule, flush, dirty } = useDebouncedSave(saveNotes);
  useKeyEvents(
    key,
    useCallback(
      (e: KeyEvent) => {
        if (e.type !== "stale") return;
        const cur = e.current as TheoryState;
        update({ id: it.id, status: cur.status, confidence: cur.confidence, notes: cur.notes ?? "" }, true);
        setNotes(cur.notes ?? "");
      },
      [it.id, update],
    ),
  );
  const complete = it.status === "completed";
  return (
    <div className={cn("flex flex-col rounded-lg border p-3 transition-colors", complete ? "border-ok/25 bg-ok-soft/30" : "border-line bg-surface-2/50")} data-testid={`concept-${it.id}`} data-status={it.status}>
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={complete}
          aria-label={`Mark ${it.name} ${complete ? "not completed" : "completed"}`}
          onClick={() => update({ id: it.id, status: complete ? "in_progress" : "completed" })}
          className={cn("mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border transition-colors", complete ? "border-ok bg-ok text-bg" : "border-line-2 hover:border-accent")}
          data-testid={`check-${it.id}`}
        >
          {complete && <Check className="size-3" strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/theory/${it.id}`} className={cn("text-[13px] leading-snug font-medium hover:text-accent", complete ? "text-fg-2" : "text-fg")}>
            {it.name}
          </Link>
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{it.description}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Badge tone="outline" title={it.objectiveTitle}>
          {it.objective}
        </Badge>
        {it.priority === "high" && <Badge tone="bad">high</Badge>}
        {it.priority === "medium" && <Badge tone="warn">medium</Badge>}
        {it.priority === "low" && <Badge tone="neutral">low</Badge>}
        {it.guideStatus !== "explicit" && <Badge tone="violet">{it.guideStatus}</Badge>}
        <Link href={`/questions?concept=${it.id}`} className="ml-auto text-[11px] text-muted hover:text-accent">
          {it.questionCount} question{it.questionCount === 1 ? "" : "s"}
          {it.accuracy !== null ? ` · ${pct(it.accuracy)}` : ""}
        </Link>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <div className="flex overflow-hidden rounded-md border border-line whitespace-nowrap" role="radiogroup" aria-label="Status">
          {STATUS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={it.status === s.id}
              onClick={() => update({ id: it.id, status: s.id })}
              className={cn("px-1.5 py-0.5 text-[10.5px] whitespace-nowrap transition-colors", it.status === s.id ? (s.id === "completed" ? "bg-ok-soft text-ok" : s.id === "in_progress" ? "bg-accent-soft text-accent" : "bg-white/[0.06] text-fg-2") : "text-faint hover:text-fg-2")}
              data-testid={`status-${it.id}-${s.id}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <select
          value={it.confidence ?? ""}
          onChange={(e) => update({ id: it.id, confidence: e.target.value || null })}
          className="h-[22px] rounded-md border border-line bg-transparent px-1 text-[10.5px] text-muted outline-none"
          aria-label="Confidence"
          data-testid={`confidence-${it.id}`}
        >
          <option value="">Confidence</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <FieldStatus syncKey={key} dirty={dirty} className="ml-auto" />
        <button type="button" onClick={() => setEditing((v) => !v)} data-testid={`notes-toggle-${it.id}`} className={cn("rounded p-1 hover:bg-white/5", notes ? "text-accent-2" : "text-faint")} aria-label="Notes">
          <NotebookPen className="size-3.5" />
        </button>
      </div>
      {editing && (
        <div className="mt-2">
          <textarea
            value={notes}
            autoFocus
            maxLength={5000}
            onChange={(e) => {
              setNotes(e.target.value);
              schedule(e.target.value);
            }}
            onBlur={flush}
            rows={3}
            placeholder="Your notes on this concept (saved automatically)"
            className="w-full rounded-md border border-line bg-surface p-2 text-xs outline-none focus-visible:border-accent"
            data-testid={`notes-${it.id}`}
          />
          <div className="mt-1 flex justify-end gap-1.5">
            <button
              type="button"
              className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] text-fg-2 hover:text-fg"
              onClick={() => {
                flush();
                setEditing(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
      {!editing && notes && <p className="mt-1.5 line-clamp-2 border-l-2 border-accent-2/40 pl-2 text-[11px] text-fg-2">{notes}</p>}
      <div className="mt-1.5 text-[10px] text-faint">{it.updatedAt ? `Updated ${relTime(it.updatedAt)}` : "Not updated yet"}</div>
    </div>
  );
}
