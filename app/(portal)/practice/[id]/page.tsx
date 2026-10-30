import Link from "next/link";
import { notFound } from "next/navigation";
import { PracticeRunner } from "@/components/practice-runner";
import { OutcomeDot } from "@/components/badges";
import { Badge, Card, CardHeader, LinkButton, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { toCardData } from "@/lib/question-data";
import { loadQuestionDetail } from "@/lib/questions";
import { getSettings } from "@/lib/settings";
import { DOMAIN_SHORT, fmtDuration, pct } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

type SP = Record<string, string | string[] | undefined>;

function outcomeOf(sq: { answeredAt: Date | null; isCorrect: boolean | null; partial: boolean }) {
  if (!sq.answeredAt) return null;
  if (sq.isCorrect === null) return "ungraded" as const;
  if (sq.isCorrect) return "correct" as const;
  return sq.partial ? ("partial" as const) : ("incorrect" as const);
}

export default async function PracticeSessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const session = await prisma.practiceSession.findFirst({
    where: { id, userId: user.id },
    include: { questions: { orderBy: { order: "asc" }, include: { question: { select: { code: true, domainNumber: true, stem: true, correctLabels: true } } } } },
  });
  if (!session || session.kind !== "practice") notFound();
  const settings = await getSettings(user.id);
  const total = session.questions.length;
  const answered = session.questions.filter((q) => q.answeredAt).length;
  const showSummary = sp.summary === "1" || session.status !== "active";

  if (showSummary) {
    const graded = session.questions.filter((q) => q.answeredAt && q.isCorrect !== null);
    const correct = graded.filter((q) => q.isCorrect).length;
    const partial = graded.filter((q) => q.partial).length;
    const ungraded = session.questions.filter((q) => q.answeredAt && q.isCorrect === null).length;
    const time = session.questions.reduce((s, q) => s + q.elapsedMs, 0);
    const byDomain = new Map<number, { n: number; c: number }>();
    for (const q of graded) {
      const d = q.question.domainNumber ?? 0;
      const e = byDomain.get(d) ?? { n: 0, c: 0 };
      e.n++;
      if (q.isCorrect) e.c++;
      byDomain.set(d, e);
    }
    const cfg = parseJson<{ note?: string | null }>(session.config, {});
    return (
      <div className="animate-in">
        <PageHeader
          crumbs={[{ label: "Practice", href: "/practice" }, { label: "Summary" }]}
          title={session.title}
          description={session.status === "active" ? "Session in progress. You can return to it at any time." : `Session ${session.status}.`}
          actions={
            <div className="flex gap-2">
              {session.status === "active" && (
                <LinkButton href={`/practice/${id}`} variant="secondary" size="sm">
                  Continue session
                </LinkButton>
              )}
              <LinkButton href="/practice" variant="primary" size="sm">
                New session
              </LinkButton>
            </div>
          }
        />
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="practice-summary">
          <Stat label="Graded score" value={graded.length ? pct(correct / graded.length) : "-"} hint={`${correct} of ${graded.length} graded correct`} />
          <Stat label="Answered" value={`${answered}/${total}`} />
          <Stat label="Partial (counted wrong)" value={partial} />
          <Stat label="Recorded, not graded" value={ungraded} hint="No verified answer" />
          <Stat label="Time" value={fmtDuration(time)} hint={answered ? `${fmtDuration(time / answered)} per question` : undefined} />
        </div>
        {cfg.note && <p className="mb-4 text-xs text-muted">{cfg.note}</p>}
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <Card>
            <CardHeader title="Questions" />
            <div className="divide-y divide-line">
              {session.questions.map((q, i) => {
                const o = outcomeOf(q);
                const sel = parseJson<string[]>(q.selectedLabels, []);
                return (
                  <Link key={q.id} href={`/questions/${q.question.code}`} className="flex items-center gap-3 px-5 py-2.5 text-xs hover:bg-white/[0.02]">
                    <span className="w-6 text-faint tabular-nums">{i + 1}</span>
                    <OutcomeDot outcome={o} />
                    <span className="font-mono text-fg-2">{q.question.code}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{q.question.stem.replace(/\[\[img:\d+\]\]/g, "")}</span>
                    <span className="text-fg-2">{sel.join(", ") || "-"}</span>
                    {o === "incorrect" || o === "partial" ? <span className="text-ok">key {parseJson<string[]>(q.question.correctLabels, []).join(", ")}</span> : null}
                  </Link>
                );
              })}
            </div>
          </Card>
          <Card>
            <CardHeader title="By domain" subtitle="Graded answers only" />
            <div className="space-y-2 px-5 pb-4">
              {[...byDomain.entries()].sort((a, b) => a[0] - b[0]).map(([d, e]) => (
                <div key={d} className="flex items-center justify-between text-xs">
                  <span className="text-fg-2">{d ? `${d} · ${DOMAIN_SHORT[d]}` : "Unmapped"}</span>
                  <Badge tone={e.c / e.n >= 0.75 ? "ok" : e.c / e.n >= 0.5 ? "warn" : "bad"}>
                    {e.c}/{e.n}
                  </Badge>
                </div>
              ))}
              {byDomain.size === 0 && <p className="text-xs text-faint">No graded answers.</p>}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const iParam = Number(typeof sp.i === "string" ? sp.i : NaN);
  const index = Math.min(total - 1, Math.max(0, Number.isFinite(iParam) ? iParam : session.currentIndex));
  const current = session.questions[index];
  const detail = await loadQuestionDetail(current.question.code, user.id);
  if (!detail) notFound();
  const data = toCardData(detail, settings.gradeContested);
  const o = outcomeOf(current);

  return (
    <div className="animate-in">
      <PageHeader crumbs={[{ label: "Practice", href: "/practice" }, { label: session.title }]} title={session.title} description={`${answered} of ${total} answered${session.immediateFeedback ? "" : " · feedback shown at the end"}`} />
      <PracticeRunner
        key={current.id}
        sessionId={id}
        index={index}
        total={total}
        immediateFeedback={session.immediateFeedback}
        keyboard={settings.keyboardShortcuts}
        data={data}
        palette={session.questions.map((q) => ({ code: q.question.code, outcome: session.immediateFeedback ? outcomeOf(q) : q.answeredAt ? "answered" : null }))}
        initialSelected={current.selectedLabels ? parseJson<string[]>(current.selectedLabels, []) : null}
        initialResult={o ? { outcome: o, provisionalOutcome: current.provisionalCorrect === null ? null : current.provisionalCorrect ? "correct" : "incorrect" } : null}
      />
    </div>
  );
}
