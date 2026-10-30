import { describe, expect, it } from "vitest";
import { buildPlan, daysBetween } from "@/lib/plan";
import { aggregate, questionStats, type AttemptLite } from "@/lib/stats";

const at = (questionId: number, isCorrect: boolean | null, minute: number, partial = false): AttemptLite => ({
  questionId,
  isCorrect,
  partial,
  createdAt: new Date(Date.UTC(2026, 9, 11, 10, minute)),
  elapsedMs: 60_000,
  mode: "practice",
  provisionalCorrect: null,
});

describe("questionStats", () => {
  it("separates first and latest graded correctness and ignores ungraded attempts for accuracy", () => {
    const s = questionStats([at(1, false, 1), at(1, null, 2), at(1, true, 3)]);
    expect(s.attempts).toBe(3);
    expect(s.graded).toBe(2);
    expect(s.firstCorrect).toBe(false);
    expect(s.latestCorrect).toBe(true);
    expect(s.latestOutcome).toBe("correct");
  });

  it("requires two consecutive correct answers for mastery after a mistake", () => {
    expect(questionStats([at(1, true, 1)]).mastered).toBe(true);
    expect(questionStats([at(1, false, 1), at(1, true, 2)]).mastered).toBe(false);
    expect(questionStats([at(1, false, 1), at(1, true, 2), at(1, true, 3)]).mastered).toBe(true);
  });

  it("reports partial as the latest outcome", () => {
    expect(questionStats([at(1, false, 1, true)]).latestOutcome).toBe("partial");
  });
});

describe("aggregate", () => {
  it("computes coverage and accuracy with consistent denominators", () => {
    const attempts = [at(1, true, 1), at(2, false, 2), at(3, null, 3)];
    const stats = [1, 2, 3, 4].map((q) => questionStats(attempts.filter((a) => a.questionId === q)));
    const a = aggregate(stats, attempts);
    expect(a.attempted).toBe(3);
    expect(a.unattempted).toBe(1);
    expect(a.gradedQuestions).toBe(2);
    expect(a.latestAccuracy).toBe(0.5);
    expect(a.overallAccuracy).toBe(0.5);
    expect(a.practiceMs).toBe(180_000);
  });
});

describe("buildPlan", () => {
  const input = {
    today: "2026-10-11",
    dailyHours: 5,
    domains: [13, 16, 21, 20, 18, 13].map((weight, i) => ({ number: i + 1, title: `D${i + 1}`, weight, unattempted: 50, accuracy: null })),
    incorrectCount: 20,
    flaggedCount: 2,
    markedCount: 3,
    highPriorityTheoryRemaining: [{ domain: 3, count: 5 }],
    mocksDone: 0,
    unattemptedHighAlignment: 40,
  };

  it("returns no plan without an exam date", () => {
    expect(buildPlan({ ...input, examDate: null }).days).toEqual([]);
  });

  it("plans three study days plus the exam day, with a mock and a final review day", () => {
    const p = buildPlan({ ...input, examDate: "2026-10-14" });
    expect(p.daysLeft).toBe(3);
    expect(p.days.map((d) => d.date)).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(p.days[3].isExamDay).toBe(true);
    expect(p.days.some((d) => d.tasks.some((t) => t.kind === "mock"))).toBe(true);
    expect(p.days[2].tasks.some((t) => t.key === "review:incorrect")).toBe(true);
    const practiced = new Set(p.days.flatMap((d) => d.tasks.filter((t) => t.kind === "practice").map((t) => t.title)));
    expect(practiced.size).toBe(6);
  });

  it("shows only the exam day when the exam is today", () => {
    const p = buildPlan({ ...input, examDate: "2026-10-11" });
    expect(p.daysLeft).toBe(0);
    expect(p.days).toHaveLength(1);
    expect(p.days[0].isExamDay && p.days[0].isToday).toBe(true);
  });

  it("returns nothing for a past exam date", () => {
    expect(buildPlan({ ...input, examDate: "2026-10-01" }).days).toEqual([]);
  });

  it("counts calendar days", () => {
    expect(daysBetween("2026-10-11", "2026-10-14")).toBe(3);
  });
});
