import Link from "next/link";
import { Play } from "lucide-react";
import { PracticeConfigForm } from "@/components/practice-config";
import { Badge, Card, CardHeader, EmptyState, PageHeader, ProgressBar, buttonClass } from "@/components/ui";
import { prisma } from "@/lib/db";
import { loadQuestionRows } from "@/lib/questions";
import { PRACTICE_MODES, type PracticeMode } from "@/lib/selection";
import { getSettings } from "@/lib/settings";
import { relTime } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

type SP = Record<string, string | string[] | undefined>;

export default async function PracticePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const [settings, rows, domains, concepts, sessions] = await Promise.all([
    getSettings(user.id),
    loadQuestionRows(user.id),
    prisma.examDomain.findMany({ orderBy: { number: "asc" } }),
    prisma.theoryConcept.findMany({ orderBy: [{ domainNumber: "asc" }, { order: "asc" }], select: { id: true, name: true, domainNumber: true, _count: { select: { questions: true } } } }),
    prisma.practiceSession.findMany({
      where: { userId: user.id, kind: "practice" },
      orderBy: { updatedAt: "desc" },
      take: 12,
      include: { questions: { select: { answeredAt: true, isCorrect: true } } },
    }),
  ]);
  const counts: Record<PracticeMode, number> = {
    all: rows.length,
    common: rows.filter((r) => r.isCommon).length,
    domain: rows.filter((r) => r.domainNumber !== null).length,
    topic: rows.filter((r) => r.conceptIds.length).length,
    incorrect: rows.filter((r) => r.stats.latestCorrect === false).length,
    unattempted: rows.filter((r) => r.stats.attempts === 0).length,
    flagged: rows.filter((r) => r.flagged).length,
    marked: rows.filter((r) => r.marked).length,
    high_alignment: rows.filter((r) => r.alignmentScore >= 0.75).length,
    weak_area: 0,
  };
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const modeParam = str("mode");
  const initial = {
    mode: (modeParam && modeParam in PRACTICE_MODES ? modeParam : "all") as PracticeMode,
    count: Number(str("count")) || settings.questionsPerSession,
    domains: (str("domain") ?? "").split(",").map(Number).filter((n) => n >= 1 && n <= 6),
    concepts: (str("concept") ?? "").split(",").filter(Boolean),
    shuffle: settings.shuffle,
    immediateFeedback: settings.immediateFeedback,
  };
  const active = sessions.filter((s) => s.status === "active");
  const past = sessions.filter((s) => s.status !== "active");

  return (
    <div className="animate-in">
      <PageHeader title="Practice" description="Build a focused session from the shared question bank. Every answer updates your progress in all views." />
      {active.length > 0 && (
        <Card className="mb-5">
          <CardHeader title="Resume a session" subtitle="Sessions are saved after every answer" />
          <div className="divide-y divide-line">
            {active.map((s) => {
              const done = s.questions.filter((q) => q.answeredAt).length;
              return (
                <div key={s.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg">{s.title}</div>
                    <div className="text-xs text-muted">
                      {done} of {s.questions.length} answered · started {relTime(s.startedAt)}
                    </div>
                  </div>
                  <ProgressBar value={s.questions.length ? done / s.questions.length : 0} className="hidden w-40 sm:block" />
                  <Link href={`/practice/${s.id}`} className={buttonClass("primary", "sm")} data-testid="resume-session">
                    <Play className="size-3.5" /> Resume
                  </Link>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      <PracticeConfigForm
        initial={initial}
        counts={counts}
        domains={domains.map((d) => ({ number: d.number, title: d.title, count: rows.filter((r) => r.domainNumber === d.number).length }))}
        concepts={concepts.map((c) => ({ id: c.id, name: c.name, domain: c.domainNumber, count: c._count.questions }))}
      />
      <Card className="mt-5">
        <CardHeader title="Recent sessions" />
        {past.length === 0 ? (
          <EmptyState title="No completed sessions yet" description="Finished sessions appear here with their scores." />
        ) : (
          <div className="divide-y divide-line">
            {past.map((s) => {
              const graded = s.questions.filter((q) => q.isCorrect !== null);
              const correct = graded.filter((q) => q.isCorrect).length;
              return (
                <Link key={s.id} href={`/practice/${s.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-fg-2">{s.title}</div>
                    <div className="text-xs text-faint">{relTime(s.submittedAt ?? s.updatedAt)}</div>
                  </div>
                  <Badge tone={s.status === "abandoned" ? "outline" : "neutral"}>{s.status === "abandoned" ? "abandoned" : `${correct}/${graded.length} correct`}</Badge>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
