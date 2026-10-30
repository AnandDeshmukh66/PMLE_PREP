import "server-only";
import { prisma } from "./db";
import { gradeAnswer } from "./grading";
import { parseJson } from "./json";
import { getSettings } from "./settings";
import { isGradable } from "./verification";

export type MockResults = {
  total: number;
  answered: number;
  unanswered: number;
  graded: { total: number; correct: number; incorrect: number; partial: number; unanswered: number; scorePct: number | null };
  provisional: { total: number; matchedProvisional: number; unanswered: number };
  timeTakenSec: number;
  timeLimitSec: number | null;
  autoSubmitted: boolean;
  byDomain: { domain: number; total: number; graded: number; correct: number; accuracy: number | null }[];
  weakConcepts: { conceptId: string; name: string; missed: number; total: number }[];
  recommendations: string[];
};

/** Grade a mock session, write one attempt per answered question, and store results. Idempotent. */
export async function submitMockSession(userId: string, sessionId: string, auto = false): Promise<MockResults | null> {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, userId, kind: "mock" },
    include: { questions: { include: { question: { include: { topics: { include: { concept: true }, orderBy: { rank: "asc" } } } } }, orderBy: { order: "asc" } } },
  });
  if (!session) return null;
  if (session.status !== "active") return parseJson<MockResults | null>(session.results, null);
  const settings = await getSettings(userId);
  const now = new Date();
  const results: MockResults = {
    total: session.questions.length,
    answered: 0,
    unanswered: 0,
    graded: { total: 0, correct: 0, incorrect: 0, partial: 0, unanswered: 0, scorePct: null },
    provisional: { total: 0, matchedProvisional: 0, unanswered: 0 },
    timeTakenSec: Math.round(((session.deadlineAt && now > session.deadlineAt ? session.deadlineAt : now).getTime() - session.startedAt.getTime()) / 1000),
    timeLimitSec: session.timeLimitSec,
    autoSubmitted: auto,
    byDomain: [],
    weakConcepts: [],
    recommendations: [],
  };
  const dom = new Map<number, { total: number; graded: number; correct: number }>();
  const concepts = new Map<string, { name: string; missed: number; total: number }>();

  const claimed = await prisma.$transaction(async (tx) => {
    const claim = await tx.practiceSession.updateMany({ where: { id: sessionId, userId, status: "active" }, data: { status: "submitted", submittedAt: now } });
    if (claim.count === 0) return false;
    for (const sq of session.questions) {
      const q = sq.question;
      const selected = parseJson<string[]>(sq.selectedLabels, []);
      const gradable = isGradable(q.verification, settings.gradeContested) && !!q.correctLabels;
      const correct = parseJson<string[] | null>(q.correctLabels, null);
      const provisional = parseJson<string[] | null>(q.provisionalLabels, null);
      const d = dom.get(q.domainNumber ?? 0) ?? { total: 0, graded: 0, correct: 0 };
      d.total++;
      const answered = selected.length > 0;
      if (answered) results.answered++;
      else results.unanswered++;
      let isCorrect: boolean | null = null;
      if (gradable) {
        results.graded.total++;
        d.graded++;
        if (!answered) {
          results.graded.unanswered++;
          isCorrect = false;
        } else {
          const g = gradeAnswer(selected, correct, provisional, true);
          isCorrect = g.isCorrect;
          if (g.isCorrect) {
            results.graded.correct++;
            d.correct++;
          } else {
            results.graded.incorrect++;
            if (g.partial) results.graded.partial++;
          }
          await tx.questionAttempt.create({
            data: { userId, questionId: q.id, sessionId, mode: "mock", selectedLabels: JSON.stringify(selected), isCorrect: g.isCorrect, partial: g.partial, provisionalCorrect: g.provisionalCorrect, verificationAtTime: q.verification, correctLabelsAtTime: q.correctLabels, elapsedMs: sq.elapsedMs },
          });
        }
        if (!isCorrect) {
          for (const t of q.topics.slice(0, 2)) {
            const c = concepts.get(t.conceptId) ?? { name: t.concept.name, missed: 0, total: 0 };
            c.missed++;
            concepts.set(t.conceptId, c);
          }
        }
        for (const t of q.topics.slice(0, 2)) {
          const c = concepts.get(t.conceptId) ?? { name: t.concept.name, missed: 0, total: 0 };
          c.total++;
          concepts.set(t.conceptId, c);
        }
      } else {
        results.provisional.total++;
        if (!answered) results.provisional.unanswered++;
        else {
          const g = gradeAnswer(selected, null, provisional, false);
          if (g.provisionalCorrect) results.provisional.matchedProvisional++;
          await tx.questionAttempt.create({
            data: { userId, questionId: q.id, sessionId, mode: "mock", selectedLabels: JSON.stringify(selected), isCorrect: null, partial: false, provisionalCorrect: g.provisionalCorrect, verificationAtTime: q.verification, correctLabelsAtTime: null, elapsedMs: sq.elapsedMs },
          });
        }
      }
      dom.set(q.domainNumber ?? 0, d);
      await tx.sessionQuestion.update({ where: { id: sq.id }, data: { isCorrect } });
    }
    results.graded.scorePct = results.graded.total ? results.graded.correct / results.graded.total : null;
    results.byDomain = [...dom.entries()].sort((a, b) => a[0] - b[0]).map(([domain, v]) => ({ domain, ...v, accuracy: v.graded ? v.correct / v.graded : null }));
    results.weakConcepts = [...concepts.entries()]
      .filter(([, c]) => c.missed > 0)
      .map(([conceptId, c]) => ({ conceptId, ...c }))
      .sort((a, b) => b.missed - a.missed || b.missed / b.total - a.missed / a.total)
      .slice(0, 8);
    const weakDomains = results.byDomain.filter((d) => d.accuracy !== null && d.graded >= 3).sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
    if (weakDomains[0]) results.recommendations.push(`Domain ${weakDomains[0].domain} had your lowest accuracy (${Math.round((weakDomains[0].accuracy ?? 0) * 100)}%). Run a domain practice set for it next.`);
    if (results.weakConcepts[0]) results.recommendations.push(`Review theory for: ${results.weakConcepts.slice(0, 3).map((c) => c.name).join(", ")}.`);
    if (results.graded.unanswered > 0) results.recommendations.push(`${results.graded.unanswered} gradable questions were left unanswered. Pace yourself to about 2 minutes per question and always pick an answer.`);
    if (results.graded.partial > 0) results.recommendations.push(`${results.graded.partial} multi-select answers were only partially correct. Read "(Choose two)" prompts carefully.`);
    await tx.practiceSession.update({ where: { id: sessionId }, data: { results: JSON.stringify(results) } });
    return true;
  });
  if (!claimed) {
    const done = await prisma.practiceSession.findFirst({ where: { id: sessionId, userId }, select: { results: true } });
    return parseJson<MockResults | null>(done?.results ?? null, null);
  }
  return results;
}
