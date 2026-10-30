import { describe, expect, it } from "vitest";
import { gradeAnswer } from "@/lib/grading";

describe("gradeAnswer", () => {
  it("grades single-select answers", () => {
    expect(gradeAnswer(["B"], ["B"], ["B"], true)).toMatchObject({ outcome: "correct", isCorrect: true, partial: false });
    expect(gradeAnswer(["A"], ["B"], ["B"], true)).toMatchObject({ outcome: "incorrect", isCorrect: false });
  });

  it("compares multi-select answers as unordered sets", () => {
    expect(gradeAnswer(["D", "A"], ["A", "D"], null, true).outcome).toBe("correct");
  });

  it("reports a partial match but never counts it as correct", () => {
    const r = gradeAnswer(["A"], ["A", "D"], null, true);
    expect(r.outcome).toBe("partial");
    expect(r.isCorrect).toBe(false);
    expect(r.partial).toBe(true);
  });

  it("treats a superset or a wrong pick as incorrect, not partial", () => {
    expect(gradeAnswer(["A", "B", "D"], ["A", "D"], null, true).outcome).toBe("incorrect");
    expect(gradeAnswer(["A", "C"], ["A", "D"], null, true).outcome).toBe("incorrect");
  });

  it("never gives a definitive judgment for unverified answers", () => {
    const r = gradeAnswer(["C"], null, ["C"], false);
    expect(r.outcome).toBe("ungraded");
    expect(r.isCorrect).toBeNull();
    expect(r.provisionalCorrect).toBe(true);
    expect(r.provisionalOutcome).toBe("correct");
    expect(gradeAnswer(["A"], ["A"], ["A"], false).isCorrect).toBeNull();
  });
});
