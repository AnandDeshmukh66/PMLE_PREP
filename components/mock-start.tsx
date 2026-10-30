"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play } from "lucide-react";
import { createMockExam } from "@/lib/actions";
import { callServer } from "@/lib/call-server";
import { Button, Card, CardHeader } from "./ui";

type Defaults = { mockQuestions: number; mockMinutes: number; mockFallback: "redistribute" | "shrink"; mockExcludeLegacy: boolean; mockOnlyGradable: boolean };

export function MockStart({ defaults, hasActive }: { defaults: Defaults; hasActive: boolean }) {
  const router = useRouter();
  const [cfg, setCfg] = useState(defaults);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Defaults>(k: K, v: Defaults[K]) => setCfg((c) => ({ ...c, [k]: v }));

  return (
    <Card>
      <CardHeader title="Start a mock exam" subtitle="Real exam: 50–60 questions in 120 minutes" />
      <div className="space-y-3 px-5 pb-5 text-xs text-fg-2">
        <div className="grid grid-cols-2 gap-3">
          <label>
            Questions
            <input type="number" min={5} max={120} value={cfg.mockQuestions} onChange={(e) => set("mockQuestions", Math.max(5, Math.min(120, Number(e.target.value) || 60)))} className="mt-1 h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus-visible:border-accent" data-testid="mock-count" />
          </label>
          <label>
            Minutes
            <input type="number" min={1} max={240} value={cfg.mockMinutes} onChange={(e) => set("mockMinutes", Math.max(1, Math.min(240, Number(e.target.value) || 120)))} className="mt-1 h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-sm outline-none focus-visible:border-accent" data-testid="mock-minutes" />
          </label>
        </div>
        <label className="block">
          If a domain lacks eligible questions
          <select value={cfg.mockFallback} onChange={(e) => set("mockFallback", e.target.value as Defaults["mockFallback"])} className="mt-1 h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-sm outline-none focus-visible:border-accent">
            <option value="redistribute">Redistribute the shortfall by weight</option>
            <option value="shrink">Shorten the exam</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.mockOnlyGradable} onChange={(e) => set("mockOnlyGradable", e.target.checked)} /> Only questions with a verified answer
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cfg.mockExcludeLegacy} onChange={(e) => set("mockExcludeLegacy", e.target.checked)} /> Exclude outdated or deprecated questions
        </label>
        <p className="text-[11px] leading-relaxed text-muted">The timer keeps running if you close the tab. The exam is submitted automatically when time runs out. Changes here apply to this exam only; set defaults in Settings.</p>
        <Button
          variant="primary"
          className="w-full"
          disabled={pending}
          data-testid="start-mock"
          onClick={() => {
            if (hasActive && !confirm("A mock exam is already in progress. Start another one anyway?")) return;
            setErr(null);
            start(async () => {
              const res = await callServer(() => createMockExam(cfg));
              if (!res.ok) return setErr(res.error);
              const r = res.value;
              if (!r.id) setErr(r.error ?? "Could not create the exam.");
              else router.push(`/mock/${r.id}`);
            });
          }}
        >
          <Play className="size-3.5" /> {pending ? "Assembling…" : "Begin mock exam"}
        </Button>
        {err && <p className="text-bad">{err}</p>}
      </div>
    </Card>
  );
}
