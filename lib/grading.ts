import { sortedLabels } from "./json";

export type Outcome = "correct" | "incorrect" | "partial" | "ungraded";

export type GradeResult = {
  outcome: Outcome;
  isCorrect: boolean | null;
  partial: boolean;
  provisionalCorrect: boolean | null;
  provisionalOutcome: Outcome | null;
};

function compare(selected: string[], key: string[]): Outcome {
  const s = sortedLabels(selected);
  const k = sortedLabels(key);
  if (s.length === k.length && s.every((l, i) => l === k[i])) return "correct";
  const hits = s.filter((l) => k.includes(l)).length;
  const wrong = s.length - hits;
  if (hits > 0 && wrong === 0) return "partial";
  return "incorrect";
}

/**
 * Multi-select answers are compared as unordered sets. "partial" (a strict subset of the
 * key with no wrong picks) is never counted as correct.
 */
export function gradeAnswer(selected: string[], correct: string[] | null, provisional: string[] | null, gradable: boolean): GradeResult {
  const prov = provisional && provisional.length ? compare(selected, provisional) : null;
  if (!gradable || !correct || !correct.length) {
    return { outcome: "ungraded", isCorrect: null, partial: false, provisionalCorrect: prov === null ? null : prov === "correct", provisionalOutcome: prov };
  }
  const outcome = compare(selected, correct);
  return { outcome, isCorrect: outcome === "correct", partial: outcome === "partial", provisionalCorrect: outcome === "correct", provisionalOutcome: outcome };
}
