export type AttemptLite = { questionId: number; isCorrect: boolean | null; partial: boolean; createdAt: Date; elapsedMs: number; mode: string; provisionalCorrect: boolean | null };

export type QuestionStats = {
  attempts: number;
  graded: number;
  correctAttempts: number;
  firstCorrect: boolean | null;
  latestCorrect: boolean | null;
  latestOutcome: "correct" | "incorrect" | "partial" | "ungraded" | null;
  lastAttemptAt: Date | null;
  everIncorrect: boolean;
  mastered: boolean;
  incorrectCount: number;
};

/**
 * Metric definitions (shared by every view):
 * - attempted: at least one attempt of any kind (graded or not).
 * - firstCorrect / latestCorrect: correctness of the first / most recent *graded* attempt.
 * - mastered: most recent graded attempt is correct AND (no incorrect graded attempts ever,
 *   or the last two graded attempts are both correct).
 */
export function questionStats(attempts: AttemptLite[]): QuestionStats {
  const sorted = [...attempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const graded = sorted.filter((a) => a.isCorrect !== null);
  const last = sorted[sorted.length - 1];
  const lastGraded = graded[graded.length - 1];
  const incorrectCount = graded.filter((a) => a.isCorrect === false).length;
  const lastTwo = graded.slice(-2);
  const mastered = !!lastGraded?.isCorrect && (incorrectCount === 0 || (lastTwo.length === 2 && lastTwo.every((a) => a.isCorrect)));
  let latestOutcome: QuestionStats["latestOutcome"] = null;
  if (last) latestOutcome = last.isCorrect === null ? "ungraded" : last.isCorrect ? "correct" : last.partial ? "partial" : "incorrect";
  return {
    attempts: sorted.length,
    graded: graded.length,
    correctAttempts: graded.filter((a) => a.isCorrect).length,
    firstCorrect: graded[0] ? !!graded[0].isCorrect : null,
    latestCorrect: lastGraded ? !!lastGraded.isCorrect : null,
    latestOutcome,
    lastAttemptAt: last?.createdAt ?? null,
    everIncorrect: incorrectCount > 0,
    mastered,
    incorrectCount,
  };
}

export type Aggregate = {
  total: number;
  attempted: number;
  unattempted: number;
  gradedQuestions: number;
  correct: number;
  incorrect: number;
  totalAttempts: number;
  gradedAttempts: number;
  correctAttempts: number;
  overallAccuracy: number | null;
  firstAttemptAccuracy: number | null;
  latestAccuracy: number | null;
  mastered: number;
  practiceMs: number;
};

export function aggregate(statsList: QuestionStats[], attempts: AttemptLite[]): Aggregate {
  const attempted = statsList.filter((s) => s.attempts > 0).length;
  const gradedQ = statsList.filter((s) => s.graded > 0);
  const correct = gradedQ.filter((s) => s.latestCorrect).length;
  const graded = attempts.filter((a) => a.isCorrect !== null);
  const ratio = (n: number, d: number) => (d ? n / d : null);
  return {
    total: statsList.length,
    attempted,
    unattempted: statsList.length - attempted,
    gradedQuestions: gradedQ.length,
    correct,
    incorrect: gradedQ.length - correct,
    totalAttempts: attempts.length,
    gradedAttempts: graded.length,
    correctAttempts: graded.filter((a) => a.isCorrect).length,
    overallAccuracy: ratio(graded.filter((a) => a.isCorrect).length, graded.length),
    firstAttemptAccuracy: ratio(gradedQ.filter((s) => s.firstCorrect).length, gradedQ.length),
    latestAccuracy: ratio(correct, gradedQ.length),
    mastered: statsList.filter((s) => s.mastered).length,
    practiceMs: attempts.reduce((a, b) => a + b.elapsedMs, 0),
  };
}
