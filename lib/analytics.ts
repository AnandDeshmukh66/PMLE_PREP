import "server-only";
import { prisma } from "./db";
import { parseJson } from "./json";
import type { MockResults } from "./mock";
import { loadQuestionRows, type QuestionRow } from "./questions";
import { aggregate, type AttemptLite } from "./stats";

export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type DomainStat = {
  number: number;
  title: string;
  weight: number | null;
  bankCount: number;
  bankShare: number;
  attempted: number;
  gradedQuestions: number;
  latestCorrect: number;
  accuracy: number | null;
  coverage: number;
  theoryTotal: number;
  theoryCompleted: number;
  theoryInProgress: number;
  mockAccuracy: number | null;
};

export type ConceptStat = {
  id: string;
  name: string;
  category: string;
  domain: number;
  objective: string;
  priority: string;
  guideStatus: string;
  status: string;
  confidence: string | null;
  questionCount: number;
  attempted: number;
  graded: number;
  correct: number;
  accuracy: number | null;
  incorrectQuestions: number;
  repeatedMistakes: number;
  avgAlignment: number;
  lastPracticed: Date | null;
};

export async function loadAnalytics(userId: string) {
  const [rows, domains, objectives, conceptRows, attempts, mocks] = await Promise.all([
    loadQuestionRows(userId),
    prisma.examDomain.findMany({ orderBy: { number: "asc" } }),
    prisma.examObjective.findMany({ orderBy: { order: "asc" } }),
    prisma.theoryConcept.findMany({ include: { progress: { where: { userId } } }, orderBy: { order: "asc" } }),
    prisma.questionAttempt.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { questionId: true, isCorrect: true, partial: true, createdAt: true, elapsedMs: true, mode: true, provisionalCorrect: true } }),
    prisma.practiceSession.findMany({ where: { userId, kind: "mock", status: "submitted" }, orderBy: { submittedAt: "asc" } }),
  ]);
  const concepts = conceptRows.map(({ progress, ...c }) => ({ ...c, progress: progress[0] ?? null }));
  const agg = aggregate(
    rows.map((r) => r.stats),
    attempts as AttemptLite[],
  );
  const total = rows.length;
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // mock accuracy per domain across all submitted mocks
  const mockDom = new Map<number, { graded: number; correct: number }>();
  const mockHistory = mocks.map((m) => {
    const r = parseJson<MockResults | null>(m.results, null);
    for (const d of r?.byDomain ?? []) {
      const x = mockDom.get(d.domain) ?? { graded: 0, correct: 0 };
      x.graded += d.graded;
      x.correct += d.correct;
      mockDom.set(d.domain, x);
    }
    return { id: m.id, date: m.submittedAt ?? m.startedAt, scorePct: r?.graded.scorePct ?? null, total: r?.total ?? 0, correct: r?.graded.correct ?? 0, graded: r?.graded.total ?? 0, timeTakenSec: r?.timeTakenSec ?? 0, provisional: r?.provisional.total ?? 0 };
  });

  const domainStats: DomainStat[] = domains.map((d) => {
    const dr = rows.filter((r) => r.domainNumber === d.number);
    const graded = dr.filter((r) => r.stats.graded > 0);
    const latestCorrect = graded.filter((r) => r.stats.latestCorrect).length;
    const dc = concepts.filter((c) => c.domainNumber === d.number);
    const md = mockDom.get(d.number);
    return {
      number: d.number,
      title: d.title,
      weight: d.weightPercent,
      bankCount: dr.length,
      bankShare: total ? dr.length / total : 0,
      attempted: dr.filter((r) => r.stats.attempts > 0).length,
      gradedQuestions: graded.length,
      latestCorrect,
      accuracy: graded.length ? latestCorrect / graded.length : null,
      coverage: dr.length ? dr.filter((r) => r.stats.attempts > 0).length / dr.length : 0,
      theoryTotal: dc.length,
      theoryCompleted: dc.filter((c) => c.progress?.status === "completed").length,
      theoryInProgress: dc.filter((c) => c.progress?.status === "in_progress").length,
      mockAccuracy: md && md.graded ? md.correct / md.graded : null,
    };
  });

  const objectiveStats = objectives.map((o) => {
    const or = rows.filter((r) => r.objectiveCode === o.code);
    const graded = or.filter((r) => r.stats.graded > 0);
    const oc = concepts.filter((c) => c.objectiveCode === o.code);
    return {
      code: o.code,
      domain: o.domainNumber,
      title: o.title,
      considerations: parseJson<string[]>(o.considerations, []),
      questionCount: or.length,
      attempted: or.filter((r) => r.stats.attempts > 0).length,
      accuracy: graded.length ? graded.filter((r) => r.stats.latestCorrect).length / graded.length : null,
      theoryTotal: oc.length,
      theoryCompleted: oc.filter((c) => c.progress?.status === "completed").length,
      avgAlignment: or.length ? or.reduce((a, r) => a + r.alignmentScore, 0) / or.length : 0,
    };
  });

  const byConcept = new Map<string, QuestionRow[]>();
  for (const r of rows) for (const c of r.conceptIds) (byConcept.get(c) ?? byConcept.set(c, []).get(c)!).push(r);
  const conceptStats: ConceptStat[] = concepts.map((c) => {
    const cr = byConcept.get(c.id) ?? [];
    const graded = cr.reduce((a, r) => a + r.stats.graded, 0);
    const correct = cr.reduce((a, r) => a + r.stats.correctAttempts, 0);
    const last = cr.reduce<Date | null>((m, r) => (r.stats.lastAttemptAt && (!m || r.stats.lastAttemptAt > m) ? r.stats.lastAttemptAt : m), null);
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      domain: c.domainNumber,
      objective: c.objectiveCode,
      priority: c.priority,
      guideStatus: c.guideStatus,
      status: c.progress?.status ?? "not_started",
      confidence: c.progress?.confidence ?? null,
      questionCount: cr.length,
      attempted: cr.filter((r) => r.stats.attempts > 0).length,
      graded,
      correct,
      accuracy: graded ? correct / graded : null,
      incorrectQuestions: cr.filter((r) => r.stats.latestCorrect === false).length,
      repeatedMistakes: cr.filter((r) => r.stats.incorrectCount >= 2).length,
      avgAlignment: cr.length ? cr.reduce((a, r) => a + r.alignmentScore, 0) / cr.length : 0,
      lastPracticed: last,
    };
  });

  // daily series
  const days = new Map<string, { date: string; attempts: number; graded: number; correct: number; newQuestions: number; ms: number }>();
  const seen = new Set<number>();
  for (const a of attempts) {
    const k = localDate(a.createdAt);
    const d = days.get(k) ?? { date: k, attempts: 0, graded: 0, correct: 0, newQuestions: 0, ms: 0 };
    d.attempts++;
    d.ms += a.elapsedMs;
    if (a.isCorrect !== null) {
      d.graded++;
      if (a.isCorrect) d.correct++;
    }
    if (!seen.has(a.questionId)) {
      seen.add(a.questionId);
      d.newQuestions++;
    }
    days.set(k, d);
  }
  let cum = 0;
  const daily = [...days.values()].map((d) => {
    cum += d.newQuestions;
    return { ...d, accuracy: d.graded ? d.correct / d.graded : null, cumulativeCoverage: total ? cum / total : 0, cumulative: cum };
  });

  const theoryTotal = concepts.length;
  const theoryCompleted = concepts.filter((c) => c.progress?.status === "completed").length;
  const theoryInProgress = concepts.filter((c) => c.progress?.status === "in_progress").length;
  const theoryUpdates = concepts
    .filter((c) => c.progress)
    .map((c) => ({ date: localDate(c.progress!.updatedAt), status: c.progress!.status }))
    .sort((a, b) => a.date.localeCompare(b.date));
  let tc = 0;
  const theoryByDay = new Map<string, number>();
  for (const u of theoryUpdates) {
    if (u.status === "completed") tc++;
    theoryByDay.set(u.date, tc);
  }

  // unofficial readiness heuristic: Σ weight × latest accuracy × min(1, coverage / 0.6)
  const wsum = domainStats.reduce((a, d) => a + (d.weight ?? 0), 0) || 1;
  const readiness = domainStats.reduce((a, d) => a + ((d.weight ?? 0) / wsum) * (d.accuracy ?? 0) * Math.min(1, d.coverage / 0.6), 0);

  const recentWrong = rows
    .filter((r) => r.stats.incorrectCount > 0)
    .sort((a, b) => b.stats.incorrectCount - a.stats.incorrectCount || (b.stats.lastAttemptAt?.getTime() ?? 0) - (a.stats.lastAttemptAt?.getTime() ?? 0))
    .slice(0, 15);

  return {
    rows,
    rowById,
    agg,
    domainStats,
    objectiveStats,
    conceptStats,
    daily,
    theory: { total: theoryTotal, completed: theoryCompleted, inProgress: theoryInProgress, byDay: [...theoryByDay.entries()].map(([date, completed]) => ({ date, completed })) },
    mockHistory,
    readiness,
    recentWrong,
    flagged: rows.filter((r) => r.flagged).length,
    marked: rows.filter((r) => r.marked).length,
  };
}

export type Analytics = Awaited<ReturnType<typeof loadAnalytics>>;

export type RevisionItem = { conceptId: string; name: string; domain: number; score: number; reasons: string[]; questionCount: number; accuracy: number | null };

/**
 * Revision priority (0-1), transparent weights:
 * 0.25 domain weight · 0.15 average question alignment · 0.25 error rate (latest-incorrect share, boosted by repeated
 * mistakes) · 0.10 low self-rated confidence · 0.15 incomplete high-priority theory · 0.10 staleness (days since practice / 3).
 */
export function revisionQueue(a: Analytics, now = new Date()): RevisionItem[] {
  const weights = new Map(a.domainStats.map((d) => [d.number, d.weight ?? 0]));
  const maxW = Math.max(...weights.values(), 1);
  return a.conceptStats
    .filter((c) => c.questionCount > 0 || c.priority === "high")
    .map((c) => {
      const reasons: string[] = [];
      const dw = (weights.get(c.domain) ?? 0) / maxW;
      const err = c.attempted ? Math.min(1, c.incorrectQuestions / Math.max(1, c.attempted) + 0.2 * c.repeatedMistakes) : 0.5;
      const lowConf = c.confidence === "low" ? 1 : c.confidence === "medium" ? 0.4 : c.confidence === "high" ? 0 : 0.5;
      const theoryGap = c.status === "completed" ? 0 : c.priority === "high" ? 1 : c.priority === "medium" ? 0.5 : 0.2;
      const days = c.lastPracticed ? (now.getTime() - c.lastPracticed.getTime()) / 86_400_000 : 3;
      const stale = Math.min(1, days / 3);
      const score = 0.25 * dw + 0.15 * c.avgAlignment + 0.25 * err + 0.1 * lowConf + 0.15 * theoryGap + 0.1 * stale;
      if (c.incorrectQuestions) reasons.push(`${c.incorrectQuestions} question(s) currently wrong`);
      if (c.repeatedMistakes) reasons.push(`${c.repeatedMistakes} repeated mistake(s)`);
      if (!c.attempted && c.questionCount) reasons.push("not practiced yet");
      if (c.status !== "completed" && c.priority === "high") reasons.push("high-priority theory incomplete");
      if (c.confidence === "low") reasons.push("low self-rated confidence");
      if (dw >= 0.9) reasons.push("high-weight domain");
      return { conceptId: c.id, name: c.name, domain: c.domain, score, reasons, questionCount: c.questionCount, accuracy: c.accuracy };
    })
    .sort((x, y) => y.score - x.score);
}

export function nextAction(a: Analytics): { title: string; detail: string; href: string } {
  const weakest = [...a.domainStats].filter((d) => d.accuracy !== null && d.gradedQuestions >= 5).sort((x, y) => (x.accuracy ?? 0) - (y.accuracy ?? 0))[0];
  if (a.agg.totalAttempts === 0) return { title: "Start with a high-alignment practice set", detail: "20 questions most closely aligned to the June 2026 guide, with immediate feedback.", href: "/practice?mode=high_alignment" };
  const incorrect = a.rows.filter((r) => r.stats.latestCorrect === false).length;
  if (incorrect >= 15) return { title: `Retry ${incorrect} incorrect questions`, detail: "Clearing current mistakes is the fastest accuracy gain.", href: "/practice?mode=incorrect" };
  if (a.agg.attempted >= 120 && a.mockHistory.length === 0) return { title: "Take your first timed mock exam", detail: "60 questions in 120 minutes, balanced by official domain weights.", href: "/mock" };
  if (weakest && (weakest.accuracy ?? 1) < 0.7) return { title: `Practice Domain ${weakest.number}: ${weakest.title}`, detail: `Your latest accuracy here is ${Math.round((weakest.accuracy ?? 0) * 100)}%.`, href: `/practice?mode=domain&domain=${weakest.number}` };
  if (a.agg.unattempted > 0) return { title: `Continue with ${Math.min(25, a.agg.unattempted)} unattempted questions`, detail: `${a.agg.unattempted} questions are still unattempted.`, href: "/practice?mode=unattempted" };
  return { title: "Take another mock exam", detail: "Track timing and domain balance under exam conditions.", href: "/mock" };
}
