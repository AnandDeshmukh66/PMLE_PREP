import Link from "next/link";
import { Play, Timer } from "lucide-react";
import { MockStart } from "@/components/mock-start";
import { Badge, Card, CardHeader, EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import type { MockResults } from "@/lib/mock";
import { loadQuestionRows } from "@/lib/questions";
import { selectMock } from "@/lib/selection";
import { getSettings } from "@/lib/settings";
import { DOMAIN_SHORT, fmtDuration, nowMs, pct, relTime } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

export default async function MockPage() {
  const user = await requireUser();
  const [settings, rows, domains, sessions] = await Promise.all([
    getSettings(user.id),
    loadQuestionRows(user.id),
    prisma.examDomain.findMany({ orderBy: { number: "asc" } }),
    prisma.practiceSession.findMany({ where: { userId: user.id, kind: "mock" }, orderBy: { startedAt: "desc" }, take: 20, include: { _count: { select: { questions: true } } } }),
  ]);
  const weights = domains.map((d) => ({ domain: d.number, weight: d.weightPercent ?? 0 }));
  const preview = selectMock(rows, weights, { total: settings.mockQuestions, fallback: settings.mockFallback, excludeLegacy: settings.mockExcludeLegacy, onlyGradable: settings.mockOnlyGradable, seed: 1 });
  const active = sessions.filter((s) => s.status === "active");
  const done = sessions.filter((s) => s.status === "submitted");

  return (
    <div className="animate-in">
      <PageHeader title="Mock Examination" description="A timed, exam-style test drawn by the official June 2026 domain weights. No feedback until you submit." />
      {active.map((s) => (
        <Card key={s.id} className="mb-5 border-accent/30">
          <div className="flex flex-wrap items-center gap-4 px-5 py-4">
            <Timer className="size-5 text-accent" />
            <div className="flex-1">
              <div className="text-sm font-medium text-fg">Mock exam in progress</div>
              <div className="text-xs text-muted">
                {s._count.questions} questions · started {relTime(s.startedAt)} · {s.deadlineAt && s.deadlineAt > new Date() ? `${fmtDuration(s.deadlineAt.getTime() - nowMs())} remaining` : "time expired, will be auto-submitted on open"}
              </div>
            </div>
            <Link href={`/mock/${s.id}`} className={buttonClass("primary", "sm")} data-testid="resume-mock">
              <Play className="size-3.5" /> Resume
            </Link>
          </div>
        </Card>
      ))}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Domain allocation preview" subtitle={`Largest-remainder apportionment of ${settings.mockQuestions} questions by official weight`} />
          <table className="w-full text-xs">
            <thead className="text-left text-faint">
              <tr className="border-b border-line">
                <th className="px-5 py-2 font-medium">Domain</th>
                <th className="px-2 py-2 text-right font-medium">Weight</th>
                <th className="px-2 py-2 text-right font-medium">Ideal</th>
                <th className="px-2 py-2 text-right font-medium">Quota</th>
                <th className="px-2 py-2 text-right font-medium">Eligible</th>
                <th className="px-5 py-2 text-right font-medium">Allocated</th>
              </tr>
            </thead>
            <tbody data-testid="allocation-table">
              {preview.plan.domains.map((d) => (
                <tr key={d.domain} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2 text-fg-2">
                    {d.domain} · {DOMAIN_SHORT[d.domain]}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{d.weight}%</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{d.idealShare.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-fg-2">{d.quota}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{d.available}</td>
                  <td className="px-5 py-2 text-right font-medium tabular-nums text-fg">
                    {d.allocated}
                    {d.shortfall > 0 && <span className="ml-1 text-warn">(−{d.shortfall})</span>}
                    {d.extra > 0 && <span className="ml-1 text-ok">(+{d.extra})</span>}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <td className="px-5 py-2 font-medium text-fg-2">Total</td>
                <td className="px-2 py-2 text-right tabular-nums text-muted">{weights.reduce((a, w) => a + w.weight, 0)}%</td>
                <td />
                <td className="px-2 py-2 text-right tabular-nums text-fg-2">{preview.plan.domains.reduce((a, d) => a + d.quota, 0)}</td>
                <td />
                <td className="px-5 py-2 text-right font-semibold tabular-nums text-fg">{preview.plan.total}</td>
              </tr>
            </tbody>
          </table>
          <div className="space-y-1 px-5 py-4 text-xs text-muted">
            {preview.plan.disclosures.map((d, i) => (
              <p key={i}>• {d}</p>
            ))}
            {Object.entries(preview.plan.excluded).map(([k, v]) => (v ? <p key={k}>• Excluded from the pool: {v} {k.replaceAll("_", " ")}.</p> : null))}
          </div>
        </Card>
        <MockStart
          defaults={{ mockQuestions: settings.mockQuestions, mockMinutes: settings.mockMinutes, mockFallback: settings.mockFallback, mockExcludeLegacy: settings.mockExcludeLegacy, mockOnlyGradable: settings.mockOnlyGradable }}
          hasActive={active.length > 0}
        />
      </div>
      <Card className="mt-5">
        <CardHeader title="History" subtitle="Graded score covers questions with a verified answer only" />
        {done.length === 0 ? (
          <EmptyState title="No mock exams yet" description="Your submitted mock exams and scores will appear here." />
        ) : (
          <div className="divide-y divide-line">
            {done.map((s) => {
              const r = parseJson<MockResults | null>(s.results, null);
              return (
                <Link key={s.id} href={`/mock/${s.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02]" data-testid="mock-history-row">
                  <div className="flex-1">
                    <div className="text-sm text-fg-2">{s.title}</div>
                    <div className="text-xs text-faint">
                      {relTime(s.submittedAt)} · {r ? fmtDuration(r.timeTakenSec * 1000) : ""}
                      {r?.autoSubmitted ? " · auto-submitted" : ""}
                    </div>
                  </div>
                  {r && (
                    <Badge tone={(r.graded.scorePct ?? 0) >= 0.75 ? "ok" : (r.graded.scorePct ?? 0) >= 0.6 ? "warn" : "bad"}>
                      {pct(r.graded.scorePct)} · {r.graded.correct}/{r.graded.total}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
