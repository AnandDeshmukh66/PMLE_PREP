import Link from "next/link";
import { notFound } from "next/navigation";
import { OutcomeDot, VerificationBadge } from "@/components/badges";
import { MockRunner, type MockQuestion } from "@/components/mock-runner";
import { Badge, Card, CardHeader, LinkButton, PageHeader, ProgressBar, Stat } from "@/components/ui";
import type { AllocationPlan } from "@/lib/allocation";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { submitMockSession, type MockResults } from "@/lib/mock";
import { getSettings } from "@/lib/settings";
import { cn, DOMAIN_SHORT, fmtDuration, nowMs, pct } from "@/lib/utils";
import { isGradable } from "@/lib/verification";
import { requireUser } from "@/lib/auth";

async function loadSession(id: string, userId: string) {
  return prisma.practiceSession.findFirst({
    where: { id, userId },
    include: {
      questions: {
        orderBy: { order: "asc" },
        include: {
          question: {
            include: { options: { orderBy: { order: "asc" } }, occurrences: { select: { id: true, images: true } } },
          },
        },
      },
    },
  });
}

export default async function MockSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  let session = await loadSession(id, user.id);
  if (!session || session.kind !== "mock") notFound();
  if (session.status === "active" && session.deadlineAt && session.deadlineAt.getTime() <= nowMs()) {
    await submitMockSession(user.id, id, true);
    session = (await loadSession(id, user.id))!;
  }
  const settings = await getSettings(user.id);
  const plan = parseJson<(AllocationPlan & { excluded?: Record<string, number> }) | null>(session.allocation, null);

  if (session.status === "active") {
    const questions: MockQuestion[] = session.questions.map((sq) => {
      const q = sq.question;
      const primary = q.occurrences.find((o) => o.id === q.primaryOccurrenceId) ?? q.occurrences[0];
      return {
        id: q.id,
        code: q.code,
        stem: q.stem,
        multiSelect: q.multiSelect,
        selectCount: q.selectCount,
        options: q.options.map((o) => ({ label: o.label, text: o.text })),
        images: primary ? parseJson(primary.images, []) : [],
        domain: q.domainNumber,
        selected: parseJson<string[]>(sq.selectedLabels, []),
        marked: sq.markedInSession,
      };
    });
    return (
      <MockRunner
        sessionId={id}
        title={session.title}
        questions={questions}
        startIndex={Math.min(session.currentIndex, questions.length - 1)}
        deadline={session.deadlineAt!.toISOString()}
        serverNow={new Date().toISOString()}
        showTimer={settings.showTimer}
        keyboard={settings.keyboardShortcuts}
      />
    );
  }

  const r = parseJson<MockResults | null>(session.results, null);
  if (!r) notFound();
  return (
    <div className="animate-in">
      <PageHeader
        crumbs={[{ label: "Mock Examination", href: "/mock" }, { label: "Results" }]}
        title="Mock exam results"
        description={`${session.title} · submitted ${session.submittedAt?.toLocaleString() ?? ""}${r.autoSubmitted ? " · auto-submitted at time-out" : ""}`}
        actions={
          <LinkButton href="/mock" variant="primary" size="sm">
            New mock exam
          </LinkButton>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="mock-results">
        <Stat label="Graded score" value={pct(r.graded.scorePct)} hint={`${r.graded.correct} of ${r.graded.total} verified questions`} tone={(r.graded.scorePct ?? 0) >= 0.75 ? "ok" : (r.graded.scorePct ?? 0) >= 0.6 ? "warn" : "bad"} />
        <Stat label="Incorrect" value={r.graded.incorrect + r.graded.unanswered} hint={`${r.graded.partial} partial · ${r.graded.unanswered} unanswered`} />
        <Stat label="Provisional (not scored)" value={`${r.provisional.matchedProvisional}/${r.provisional.total}`} hint="Matched the best-supported unverified answer" />
        <Stat label="Time" value={fmtDuration(r.timeTakenSec * 1000)} hint={r.timeLimitSec ? `of ${fmtDuration(r.timeLimitSec * 1000)} · ${fmtDuration((r.timeTakenSec * 1000) / Math.max(1, r.answered))} per answer` : undefined} />
      </div>
      <p className="mb-5 text-xs text-muted">The graded score counts only questions whose answer is verified. Unanswered gradable questions count as incorrect. Questions without a verified answer are reported separately and never affect the score. Google does not publish a passing score, so this is not a pass prediction.</p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Performance by domain" />
          <div className="space-y-3 px-5 pb-5">
            {r.byDomain.map((d) => (
              <div key={d.domain}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-fg-2">{d.domain ? `${d.domain} · ${DOMAIN_SHORT[d.domain]}` : "Unmapped"}</span>
                  <span className="text-muted tabular-nums">
                    {d.correct}/{d.graded} graded{d.total > d.graded ? ` · ${d.total - d.graded} provisional` : ""} · {pct(d.accuracy)}
                  </span>
                </div>
                <ProgressBar value={d.accuracy ?? 0} tone={(d.accuracy ?? 0) >= 0.75 ? "ok" : (d.accuracy ?? 0) >= 0.5 ? "warn" : "bad"} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="What to do next" />
          <div className="space-y-3 px-5 pb-5 text-xs">
            {r.recommendations.length === 0 && <p className="text-muted">Strong result. Keep practicing with a fresh mock.</p>}
            {r.recommendations.map((x, i) => (
              <p key={i} className="text-fg-2">
                • {x}
              </p>
            ))}
            {r.weakConcepts.length > 0 && (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">Weak concepts</div>
                <div className="flex flex-wrap gap-1.5">
                  {r.weakConcepts.map((c) => (
                    <Link key={c.conceptId} href={`/theory/${c.conceptId}`} className="rounded-md bg-bad-soft px-2 py-1 text-[11px] text-bad hover:brightness-125">
                      {c.name} · {c.missed}/{c.total}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {plan && (
              <details className="text-muted">
                <summary className="cursor-pointer hover:text-fg-2">Allocation and disclosures</summary>
                <ul className="mt-2 space-y-1">
                  {plan.domains.map((d) => (
                    <li key={d.domain}>
                      Domain {d.domain}: {d.allocated} questions (weight {d.weight}%, quota {d.quota}
                      {d.shortfall ? `, shortfall ${d.shortfall}` : ""}
                      {d.extra ? `, +${d.extra} redistributed` : ""})
                    </li>
                  ))}
                  {plan.disclosures.map((d, i) => (
                    <li key={`d${i}`}>{d}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Question review" subtitle="Open any question to see sources, claims and explanations" />
        <div className="divide-y divide-line">
          {session.questions.map((sq, i) => {
            const q = sq.question;
            const sel = parseJson<string[]>(sq.selectedLabels, []);
            const gradable = isGradable(q.verification, settings.gradeContested) && !!q.correctLabels;
            const key = parseJson<string[]>(q.correctLabels, []);
            const outcome = !gradable ? (sel.length ? "ungraded" : null) : sq.isCorrect ? "correct" : sel.length && sel.every((s) => key.includes(s)) && sel.length < key.length ? "partial" : "incorrect";
            return (
              <Link key={sq.id} href={`/questions/${q.code}`} className="flex items-center gap-3 px-5 py-2.5 text-xs hover:bg-white/[0.02]" data-testid="mock-review-row">
                <span className="w-6 text-faint tabular-nums">{i + 1}</span>
                <OutcomeDot outcome={outcome} />
                <span className="font-mono text-fg-2">{q.code}</span>
                <Badge tone="outline">D{q.domainNumber ?? "?"}</Badge>
                <span className="min-w-0 flex-1 truncate text-muted">{q.stem.replace(/\[\[img:\d+\]\]/g, "")}</span>
                {sq.markedInSession && <Badge tone="accent">marked</Badge>}
                <span className={cn("w-14 text-right", sel.length ? "text-fg-2" : "text-faint")}>{sel.join(", ") || "blank"}</span>
                <span className="w-24 text-right">{gradable ? <span className="text-ok">key {key.join(", ")}</span> : <VerificationBadge status={q.verification} />}</span>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
