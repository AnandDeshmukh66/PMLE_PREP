import "server-only";
import { localDate, type Analytics } from "./analytics";
import { prisma } from "./db";
import { buildPlan } from "./plan";
import type { Settings } from "./settings";

export async function loadPlan(userId: string, a: Analytics, settings: Settings) {
  const today = localDate(new Date());
  const highRemaining = new Map<number, number>();
  for (const c of a.conceptStats) if (c.priority === "high" && c.status !== "completed") highRemaining.set(c.domain, (highRemaining.get(c.domain) ?? 0) + 1);
  const plan = buildPlan({
    today,
    examDate: settings.examDate,
    dailyHours: settings.dailyHours,
    domains: a.domainStats.map((d) => ({ number: d.number, title: d.title, weight: d.weight ?? 0, unattempted: d.bankCount - d.attempted, accuracy: d.accuracy })),
    incorrectCount: a.rows.filter((r) => r.stats.latestCorrect === false).length,
    flaggedCount: a.flagged,
    markedCount: a.marked,
    highPriorityTheoryRemaining: [...highRemaining.entries()].map(([domain, count]) => ({ domain, count })),
    mocksDone: a.mockHistory.length,
    unattemptedHighAlignment: a.rows.filter((r) => r.alignmentScore >= 0.75 && !r.stats.attempts).length,
  });
  const done = await prisma.studyTaskCompletion.findMany({ where: { userId, done: true, date: { in: plan.days.map((d) => d.date) } } });
  const doneSet = new Set(done.map((d) => `${d.date}|${d.taskKey}`));
  return { today, ...plan, isDone: (date: string, key: string) => doneSet.has(`${date}|${key}`) };
}
