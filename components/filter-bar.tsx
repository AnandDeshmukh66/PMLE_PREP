"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

const selectCls = "h-8 rounded-lg border border-line bg-surface-2 px-2 text-xs text-fg-2 outline-none hover:border-line-2 focus-visible:border-accent";

export function FilterBar({ conceptName, hideSource }: { conceptName?: string | null; hideSource?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const set = (k: string, v: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (v === null || v === "") p.delete(k);
    else p.set(k, v);
    start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) set("q", q || null);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const toggle = (k: string) => set(k, sp.get(k) === "1" ? null : "1");
  const active = [...sp.keys()].filter((k) => k !== "sort").length;

  return (
    <div className={cn("mb-4 flex flex-col gap-2.5 transition-opacity", pending && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[240px] flex-1 items-center">
          <Search className="pointer-events-none absolute left-2.5 size-3.5 text-faint" />
          <span className="sr-only">Search questions</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search stems, options, topics, Q-0042, pdf 84, ep 136…"
            className="h-9 w-full rounded-lg border border-line bg-surface-2 pr-3 pl-8 text-[13px] text-fg outline-none placeholder:text-faint focus-visible:border-accent"
            data-testid="search-input"
          />
        </label>
        <select aria-label="Sort" className={selectCls} value={sp.get("sort") ?? "code"} onChange={(e) => set("sort", e.target.value === "code" ? null : e.target.value)}>
          <option value="code">Sort: canonical #</option>
          <option value="alignment_desc">Alignment ↓</option>
          <option value="alignment_asc">Alignment ↑</option>
          <option value="accuracy_asc">Lowest accuracy</option>
          <option value="recent">Recently attempted</option>
          <option value="pdf_qnum">PDF question #</option>
          <option value="examprepper_qnum">ExamPrepper question #</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Domain" className={selectCls} value={sp.get("domain") ?? ""} onChange={(e) => set("domain", e.target.value || null)}>
          <option value="">All domains</option>
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <option key={d} value={d}>
              Domain {d}
            </option>
          ))}
        </select>
        {!hideSource && (
          <select aria-label="Source" className={selectCls} value={sp.get("source") ?? ""} onChange={(e) => set("source", e.target.value || null)}>
            <option value="">Any source</option>
            <option value="common">In both sources</option>
            <option value="pdf_only">PDF only</option>
            <option value="examprepper_only">ExamPrepper only</option>
          </select>
        )}
        <select aria-label="Attempt status" className={selectCls} value={sp.get("status") ?? ""} onChange={(e) => set("status", e.target.value || null)}>
          <option value="">Any status</option>
          <option value="unattempted">Unattempted</option>
          <option value="attempted">Attempted</option>
          <option value="correct">Latest correct</option>
          <option value="incorrect">Latest incorrect</option>
          <option value="ever_incorrect">Ever incorrect</option>
          <option value="mastered">Mastered</option>
        </select>
        <select aria-label="Answer verification" className={selectCls} value={sp.get("verification") ?? ""} onChange={(e) => set("verification", e.target.value || null)}>
          <option value="">Any answer status</option>
          <option value="gradable">Gradable</option>
          <option value="unverified">Unverified (conflict/contested)</option>
          <option value="verified">Verified</option>
          <option value="conflict">Conflict</option>
          <option value="contested">Contested</option>
          <option value="source_key">Single-source key</option>
          <option value="user_verified">Verified by you</option>
        </select>
        <select aria-label="Minimum alignment" className={selectCls} value={sp.get("minAlign") ?? ""} onChange={(e) => set("minAlign", e.target.value || null)}>
          <option value="">Any alignment</option>
          <option value="0.9">≥ 0.90 direct</option>
          <option value="0.75">≥ 0.75 strong</option>
          <option value="0.5">≥ 0.50 moderate</option>
          <option value="0.25">≥ 0.25 indirect</option>
        </select>
        <select aria-label="Legacy status" className={selectCls} value={sp.get("legacy") ?? ""} onChange={(e) => set("legacy", e.target.value || null)}>
          <option value="">Legacy: any</option>
          <option value="current">Hide legacy/outdated</option>
          <option value="legacy">Only legacy/outdated</option>
        </select>
        {[
          ["flagged", "Flagged"],
          ["marked", "Marked"],
          ["bookmarked", "Bookmarked"],
          ["multi", "Multi-select"],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            aria-pressed={sp.get(k) === "1"}
            className={cn("h-8 rounded-lg border px-2.5 text-xs transition-colors", sp.get(k) === "1" ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg-2")}
          >
            {label}
          </button>
        ))}
        {sp.get("objective") && (
          <button type="button" onClick={() => set("objective", null)} className="flex h-8 items-center gap-1 rounded-lg bg-violet-soft px-2.5 text-xs text-accent-2">
            Objective {sp.get("objective")} <X className="size-3" />
          </button>
        )}
        {sp.get("concept") && (
          <button type="button" onClick={() => set("concept", null)} className="flex h-8 items-center gap-1 rounded-lg bg-violet-soft px-2.5 text-xs text-accent-2">
            Topic: {conceptName ?? sp.get("concept")} <X className="size-3" />
          </button>
        )}
        {active > 0 && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              start(() => router.replace(pathname, { scroll: false }));
            }}
            className="h-8 px-2 text-xs text-faint hover:text-fg-2"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
