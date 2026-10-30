import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, Info, Play, Timer, XCircle } from "lucide-react";
import { ExamDateForm, TaskList } from "@/components/plan-ui";
import { Badge, Card, CardHeader, LinkButton, PageHeader, ProgressBar, ProgressRing, Stat } from "@/components/ui";
import { loadAnalytics, nextAction, revisionQueue } from "@/lib/analytics";
import { prisma } from "@/lib/db";
import { LEGACY_FLAGGED } from "@/lib/filters";
import { computeInventory } from "@/lib/inventory";
import { loadPlan } from "@/lib/plan-data";
import { getSettings } from "@/lib/settings";
import { DOMAIN_COLOR, fmtDuration, pct } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

async function resumeTarget(userId: string): Promise<{ href: string; label: string } | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { lastPath: true } });
  const path = u?.lastPath;
  if (!path) return null;
  const [, section, id] = path.split("?")[0].split("/");
  if (section === "practice" || section === "mock") {
    const s = id ? await prisma.practiceSession.findFirst({ where: { id, userId, status: "active" }, select: { id: true } }) : null;
    return s ? { href: path, label: section === "mock" ? "your mock exam" : "your practice session" } : null;
  }
  if (section === "questions" && id) return { href: path, label: `question ${decodeURIComponent(id)}` };
  if (section === "theory") return { href: path, label: id ? "the theory concept you were reading" : "the theory checklist" };
  return null;
}

export default async function Dashboard() {
  const user = await requireUser();
  const [settings, a, inv, active, resume] = await Promise.all([
    getSettings(user.id),
    loadAnalytics(user.id),
    computeInventory(prisma),
    prisma.practiceSession.findMany({ where: { userId: user.id, status: "active" }, orderBy: { updatedAt: "desc" }, take: 3, include: { _count: { select: { questions: true } } } }),
    resumeTarget(user.id),
  ]);
  const plan = await loadPlan(user.id, a, settings);
  const today = plan.days.find((d) => d.isToday);
  const next = nextAction(a);
  const queue = revisionQueue(a).slice(0, 6);
  const unverified = (inv.byVerification.conflict ?? 0) + (inv.byVerification.contested ?? 0) + (inv.byVerification.unknown ?? 0);
  const legacy = Object.entries(inv.byLegacy).reduce((s, [k, v]) => s + (LEGACY_FLAGGED.has(k) ? v : 0), 0);
  const ag = a.agg;

  return (
    <div className="animate-in">
      <PageHeader
        title="Dashboard"
        description="Google Cloud Professional Machine Learning Engineer · exam guide effective June 1, 2026"
        actions={
          <>
            <LinkButton href="/practice" variant="secondary" size="sm">
              <Play className="size-3.5" /> Practice
            </LinkButton>
            <LinkButton href="/mock" variant="primary" size="sm">
              <Timer className="size-3.5" /> Mock exam
            </LinkButton>
          </>
        }
      />
      {resume && (
        <Link href={resume.href} data-testid="resume-link" className="mb-5 flex items-center gap-3 rounded-[var(--radius-card)] border border-accent/30 bg-accent-soft px-4 py-3 text-[13px] text-fg transition-colors hover:border-accent/50">
          <Play className="size-4 text-accent" />
          <span>
            Continue where you left off: <span className="font-medium">{resume.label}</span>
          </span>
          <ArrowRight className="ml-auto size-4 text-accent" />
        </Link>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Card className="relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative flex flex-wrap items-center gap-6">
            <ProgressRing value={ag.total ? ag.attempted / ag.total : 0} size={112} stroke={9}>
              <div className="text-center">
                <div className="text-xl font-semibold text-fg">{pct(ag.total ? ag.attempted / ag.total : 0)}</div>
                <div className="text-[10px] font-normal text-muted">attempted</div>
              </div>
            </ProgressRing>
            <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3" data-testid="progress-stats">
              <Stat label="Attempted" value={`${ag.attempted}`} hint={`${ag.unattempted} unattempted`} />
              <Stat label="Latest accuracy" value={pct(ag.latestAccuracy)} hint={`${ag.correct} right · ${ag.incorrect} wrong`} tone={ag.latestAccuracy === null ? undefined : ag.latestAccuracy >= 0.75 ? "ok" : ag.latestAccuracy >= 0.6 ? "warn" : "bad"} />
              <Stat label="First attempt" value={pct(ag.firstAttemptAccuracy)} hint="Accuracy on first graded try" />
              <Stat label="Mastered" value={ag.mastered} hint="Right now, no lingering errors" />
              <Stat label="Theory" value={`${a.theory.completed}/${a.theory.total}`} hint={`${a.theory.inProgress} in progress`} />
              <Stat label="Practice time" value={fmtDuration(ag.practiceMs)} hint={`${ag.totalAttempts} answers`} />
            </div>
          </div>
          <div className="relative mt-5 flex flex-wrap items-center gap-4 border-t border-line pt-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-muted uppercase">
                Readiness heuristic
                <span title="Unofficial: Σ domain weight × latest accuracy × min(1, coverage ÷ 60%). Google does not publish a passing score; this is not a pass prediction.">
                  <Info className="size-3" />
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <span className="text-2xl font-semibold text-fg tabular-nums" data-testid="readiness">
                  {Math.round(a.readiness * 100)}
                </span>
                <ProgressBar value={a.readiness} tone={a.readiness >= 0.7 ? "ok" : a.readiness >= 0.5 ? "warn" : "accent"} className="max-w-xs" />
              </div>
              <div className="mt-0.5 text-[11px] text-faint">Unofficial study signal weighted by the exam blueprint, not a pass probability.</div>
            </div>
            <div className="flex items-center gap-3">
              <CalendarClock className="size-5 text-accent" />
              {plan.daysLeft !== null && plan.daysLeft >= 0 ? (
                <div>
                  <div className="text-lg font-semibold text-fg tabular-nums">{plan.daysLeft === 0 ? "Exam today" : `${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"} left`}</div>
                  <Link href="/plan" className="text-xs text-muted hover:text-accent">
                    Open study plan →
                  </Link>
                </div>
              ) : (
                <Link href="/plan" className="text-sm text-accent hover:underline">
                  Set your exam date
                </Link>
              )}
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="border-accent/30 bg-gradient-to-br from-accent/[0.08] to-transparent p-5">
            <div className="text-[11px] font-medium tracking-[0.06em] text-accent uppercase">Recommended next</div>
            <div className="mt-1 text-base font-semibold text-fg">{next.title}</div>
            <p className="mt-0.5 text-xs text-muted">{next.detail}</p>
            <LinkButton href={next.href} variant="primary" size="sm" className="mt-3" data-testid="next-action">
              Start <ArrowRight className="size-3.5" />
            </LinkButton>
          </Card>
          {active.length > 0 && (
            <Card>
              <CardHeader title="Resume" />
              <div className="divide-y divide-line">
                {active.map((s) => (
                  <Link key={s.id} href={s.kind === "mock" ? `/mock/${s.id}` : `/practice/${s.id}`} className="flex items-center gap-3 px-5 py-2.5 text-xs hover:bg-white/[0.02]">
                    {s.kind === "mock" ? <Timer className="size-4 text-warn" /> : <Play className="size-4 text-accent" />}
                    <span className="flex-1 truncate text-fg-2">{s.title}</span>
                    <span className="text-faint">{s._count.questions} questions</span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-semibold text-fg">Question inventory</div>
              <Link href="/data-quality" className="text-xs text-muted hover:text-accent">
                Data quality →
              </Link>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm tabular-nums" data-testid="inventory-identity">
              <Link href="/pdf" className="text-fg hover:text-accent">
                <span className="text-xl font-semibold">{inv.pdfSourceQuestions}</span> <span className="text-xs text-muted">PDF</span>
              </Link>
              <span className="text-faint">+</span>
              <Link href="/examprepper" className="text-fg hover:text-accent">
                <span className="text-xl font-semibold">{inv.websiteSourceQuestions}</span> <span className="text-xs text-muted">ExamPrepper</span>
              </Link>
              <span className="text-faint">−</span>
              <Link href="/common" className="text-fg hover:text-accent">
                <span className="text-xl font-semibold">{inv.confirmedOverlap}</span> <span className="text-xs text-muted">overlap</span>
              </Link>
              <span className="text-faint">=</span>
              <Link href="/questions" className="text-accent">
                <span className="text-xl font-semibold">{inv.uniqueQuestions}</span> <span className="text-xs">unique</span>
              </Link>
              {inv.identityHolds ? <CheckCircle2 className="size-4 self-center text-ok" aria-label="Identity holds" /> : <XCircle className="size-4 self-center text-bad" aria-label="Identity broken" />}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
              <Badge tone="neutral">{inv.pdfOnly} PDF only</Badge>
              <Badge tone="neutral">{inv.websiteOnly} ExamPrepper only</Badge>
              <Link href="/questions?verification=unverified">
                <Badge tone="warn">{unverified} without a verified answer</Badge>
              </Link>
              <Link href="/questions?legacy=legacy">
                <Badge tone="warn">{legacy} possibly outdated</Badge>
              </Link>
              <Badge tone="outline">{inv.withImages} with exhibits</Badge>
              <Badge tone="outline">{inv.multiSelect} multi-select</Badge>
            </div>
          </Card>
        </div>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Card>
          <CardHeader title="Domain readiness" subtitle="Official weight · coverage of the bank · latest accuracy · theory completed" action={<Link href="/analytics" className="text-xs text-muted hover:text-accent">Analytics →</Link>} />
          <div className="divide-y divide-line">
            {a.domainStats.map((d) => (
              <Link key={d.number} href={`/questions?domain=${d.number}`} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 px-5 py-3 hover:bg-white/[0.02] md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: DOMAIN_COLOR[d.number] }} />
                  <span className="truncate text-fg-2">
                    {d.number}. {d.title}
                  </span>
                  <span className="shrink-0 text-faint">{d.weight}%</span>
                </div>
                <div className="text-xs md:hidden text-muted">{pct(d.accuracy)}</div>
                <div className="hidden md:block">
                  <div className="mb-0.5 text-[10.5px] text-faint">
                    {d.attempted}/{d.bankCount} attempted
                  </div>
                  <ProgressBar value={d.coverage} />
                </div>
                <div className="hidden md:block">
                  <div className="mb-0.5 text-[10.5px] text-faint">accuracy {pct(d.accuracy)}</div>
                  <ProgressBar value={d.accuracy ?? 0} tone={d.accuracy === null ? "accent" : d.accuracy >= 0.75 ? "ok" : d.accuracy >= 0.6 ? "warn" : "bad"} />
                </div>
                <div className="hidden md:block">
                  <div className="mb-0.5 text-[10.5px] text-faint">
                    theory {d.theoryCompleted}/{d.theoryTotal}
                  </div>
                  <ProgressBar value={d.theoryTotal ? d.theoryCompleted / d.theoryTotal : 0} tone="violet" />
                </div>
              </Link>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Today's plan" subtitle={today ? `${today.tasks.length} tasks · about ${fmtDuration(today.minutes * 60_000)}` : undefined} action={<Link href="/plan" className="text-xs text-muted hover:text-accent">Full plan →</Link>} />
            <div className="px-3 pb-4">
              {today ? (
                <TaskList date={today.date} tasks={today.tasks} doneKeys={today.tasks.filter((t) => plan.isDone(today.date, t.key)).map((t) => t.key)} />
              ) : (
                <div className="px-2">
                  <p className="mb-3 text-xs text-muted">Save your exam date to get a day-by-day schedule.</p>
                  <ExamDateForm examDate={settings.examDate} dailyHours={settings.dailyHours} compact />
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Revise next" subtitle="Top of the revision priority queue" />
            <div className="divide-y divide-line">
              {queue.map((q) => (
                <Link key={q.conceptId} href={`/theory/${q.conceptId}`} className="flex items-center gap-3 px-5 py-2 text-xs hover:bg-white/[0.02]">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: DOMAIN_COLOR[q.domain] }} />
                  <span className="min-w-0 flex-1 truncate text-fg-2">{q.name}</span>
                  <span className="truncate text-faint">{q.reasons[0] ?? ""}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
