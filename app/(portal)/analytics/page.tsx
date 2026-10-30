import Link from "next/link";
import { CoverageChart, DailyActivityChart, DomainChart, MockTrendChart, TheoryTrendChart } from "@/components/charts";
import { Badge, Card, CardHeader, LinkButton, PageHeader, ProgressBar, Stat } from "@/components/ui";
import { loadAnalytics, revisionQueue } from "@/lib/analytics";
import { DOMAIN_SHORT, fmtDuration, pct, relTime } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

export default async function AnalyticsPage() {
  const user = await requireUser();
  const a = await loadAnalytics(user.id);
  const queue = revisionQueue(a).slice(0, 15);
  const weakConcepts = a.conceptStats
    .filter((c) => c.graded >= 2 && c.accuracy !== null)
    .sort((x, y) => (x.accuracy ?? 0) - (y.accuracy ?? 0))
    .slice(0, 10);
  const avgMs = a.agg.totalAttempts ? a.agg.practiceMs / a.agg.totalAttempts : 0;

  return (
    <div className="animate-in">
      <PageHeader title="Analytics" description="All metrics use the same definitions everywhere: accuracy counts graded answers only (verified keys); unverified answers are recorded but never scored." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          { l: "Attempted", v: `${a.agg.attempted}/${a.agg.total}`, h: pct(a.agg.attempted / Math.max(1, a.agg.total)) + " of the bank" },
          { l: "Latest accuracy", v: pct(a.agg.latestAccuracy), h: `${a.agg.correct}/${a.agg.gradedQuestions} questions` },
          { l: "First-attempt accuracy", v: pct(a.agg.firstAttemptAccuracy), h: "First graded try" },
          { l: "All-attempt accuracy", v: pct(a.agg.overallAccuracy), h: `${a.agg.correctAttempts}/${a.agg.gradedAttempts} attempts` },
          { l: "Mastered", v: a.agg.mastered, h: "Latest right, no lingering errors" },
          { l: "Practice time", v: fmtDuration(a.agg.practiceMs), h: avgMs ? `${fmtDuration(avgMs)} per answer` : "-" },
        ].map((s) => (
          <Card key={s.l} className="p-4">
            <Stat label={s.l} value={s.v} hint={s.h} />
          </Card>
        ))}
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Daily activity" subtitle="Attempts and graded accuracy per day" />
          <div className="h-60 px-3 pb-4">
            <DailyActivityChart data={a.daily.map((d) => ({ date: d.date, attempts: d.attempts, accuracy: d.accuracy }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Domain readiness" subtitle="Exam weight vs. your accuracy, coverage and theory" />
          <div className="h-60 px-3 pb-4">
            <DomainChart data={a.domainStats.map((d) => ({ name: `D${d.number}`, weight: (d.weight ?? 0) / 100, accuracy: d.accuracy, coverage: d.coverage, theory: d.theoryTotal ? d.theoryCompleted / d.theoryTotal : 0 }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Bank coverage over time" />
          <div className="h-48 px-3 pb-4">
            <CoverageChart data={a.daily.map((d) => ({ date: d.date, cumulativeCoverage: d.cumulativeCoverage }))} />
          </div>
        </Card>
        <div className="grid gap-5 sm:grid-cols-2">
          <Card>
            <CardHeader title="Mock exam scores" />
            <div className="h-48 px-3 pb-4">
              <MockTrendChart data={a.mockHistory.map((m, i) => ({ label: `#${i + 1}`, score: m.scorePct }))} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Theory completed" />
            <div className="h-48 px-3 pb-4">
              <TheoryTrendChart data={a.theory.byDay} total={a.theory.total} />
            </div>
          </Card>
        </div>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader
            title="Revision priority queue"
            subtitle="Weights: 25% domain weight · 15% guide alignment · 25% error rate · 10% low confidence · 15% unfinished high-priority theory · 10% time since practice"
          />
          <div className="divide-y divide-line" data-testid="revision-queue">
            {queue.map((q, i) => (
              <div key={q.conceptId} className="flex items-center gap-3 px-5 py-2.5 text-xs">
                <span className="w-5 text-faint tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/theory/${q.conceptId}`} className="font-medium text-fg-2 hover:text-accent">
                    {q.name}
                  </Link>
                  <div className="truncate text-faint">
                    D{q.domain} · {q.reasons.join(" · ") || "balanced priority"}
                  </div>
                </div>
                <span className="w-10 text-right text-muted tabular-nums">{q.score.toFixed(2)}</span>
                {q.questionCount > 0 ? (
                  <LinkButton href={`/practice?mode=topic&concept=${q.conceptId}&count=${Math.min(15, q.questionCount)}`} size="sm" variant="subtle">
                    Practice
                  </LinkButton>
                ) : (
                  <LinkButton href={`/theory/${q.conceptId}`} size="sm" variant="subtle">
                    Study
                  </LinkButton>
                )}
              </div>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Weakest concepts" subtitle="At least 2 graded attempts" />
            <div className="space-y-2 px-5 pb-4 text-xs">
              {weakConcepts.length === 0 && <p className="text-faint">Not enough graded attempts yet.</p>}
              {weakConcepts.map((c) => (
                <div key={c.id}>
                  <div className="mb-1 flex justify-between">
                    <Link href={`/theory/${c.id}`} className="truncate text-fg-2 hover:text-accent">
                      {c.name}
                    </Link>
                    <span className="text-muted tabular-nums">
                      {c.correct}/{c.graded}
                    </span>
                  </div>
                  <ProgressBar value={c.accuracy ?? 0} tone={(c.accuracy ?? 0) >= 0.7 ? "ok" : (c.accuracy ?? 0) >= 0.5 ? "warn" : "bad"} />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Repeated mistakes" subtitle="Questions answered wrong more than once rank first" />
            <div className="divide-y divide-line">
              {a.recentWrong.length === 0 && <p className="px-5 pb-4 text-xs text-faint">No mistakes recorded yet.</p>}
              {a.recentWrong.slice(0, 8).map((r) => (
                <Link key={r.id} href={`/questions/${r.code}?from=incorrect`} className="flex items-center gap-2 px-5 py-2 text-xs hover:bg-white/[0.02]">
                  <span className="font-mono text-fg-2">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{r.stem.replace(/\[\[img:\d+\]\]/g, "")}</span>
                  <Badge tone={r.stats.latestCorrect ? "ok" : "bad"}>{r.stats.incorrectCount}× wrong</Badge>
                  <span className="text-faint">{relTime(r.stats.lastAttemptAt)}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="By objective" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="text-left text-faint">
              <tr className="border-y border-line">
                <th className="px-5 py-2 font-medium">Objective</th>
                <th className="px-2 py-2 text-right font-medium">Questions</th>
                <th className="px-2 py-2 text-right font-medium">Attempted</th>
                <th className="px-2 py-2 text-right font-medium">Accuracy</th>
                <th className="px-2 py-2 text-right font-medium">Theory</th>
                <th className="px-5 py-2 text-right font-medium">Avg alignment</th>
              </tr>
            </thead>
            <tbody>
              {a.objectiveStats.map((o) => (
                <tr key={o.code} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2">
                    <Link href={`/questions?objective=${o.code}`} className="text-fg-2 hover:text-accent">
                      <span className="mr-2 font-mono text-accent">{o.code}</span>
                      {o.title}
                    </Link>
                    <span className="ml-2 text-faint">{DOMAIN_SHORT[o.domain]}</span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{o.questionCount}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">{o.attempted}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-fg-2">{pct(o.accuracy)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-muted">
                    {o.theoryCompleted}/{o.theoryTotal}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums text-muted">{o.avgAlignment.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
