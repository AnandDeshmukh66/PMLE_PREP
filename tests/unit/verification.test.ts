import { describe, expect, it } from "vitest";
import { computeVerification, isGradable } from "@/lib/verification";

const pdf = (l: string[], incomplete = false) => ({ kind: "pdf_key", labels: l, incomplete });
const ep = (l: string[]) => ({ kind: "examprepper_answer", labels: l });
const vote = (l: string[], percent: number, distribution?: { labels: string[]; percent: number }[]) => ({ kind: "community_vote", labels: l, percent, distribution });
const et = (l: string[]) => ({ kind: "examtopics_key", labels: l });

describe("computeVerification", () => {
  it("verifies when both keys agree and the community concurs", () => {
    const r = computeVerification([pdf(["B"]), ep(["B"]), vote(["B"], 88, [{ labels: ["B"], percent: 88 }, { labels: ["A"], percent: 12 }])]);
    expect(r.status).toBe("verified");
    expect(r.correct).toEqual(["B"]);
  });

  it("flags a conflict when source keys disagree and never sets a definitive answer", () => {
    const r = computeVerification([pdf(["A"]), ep(["C"]), vote(["C"], 70)]);
    expect(r.status).toBe("conflict");
    expect(r.correct).toBeNull();
    expect(r.provisional).toEqual(["C"]);
  });

  it("marks contested when the ExamTopics key dissents", () => {
    const r = computeVerification([pdf(["D"]), ep(["D"]), et(["A"])]);
    expect(r.status).toBe("contested");
    expect(r.correct).toBeNull();
    expect(r.provisional).toEqual(["D"]);
  });

  it("marks contested when the community majority disagrees", () => {
    const r = computeVerification([pdf(["A"]), ep(["A"]), vote(["B"], 64)]);
    expect(r.status).toBe("contested");
  });

  it("marks contested on a near-tie vote", () => {
    const r = computeVerification([pdf(["A"]), ep(["A"]), vote(["A"], 52, [{ labels: ["A"], percent: 52 }, { labels: ["B"], percent: 40 }])]);
    expect(r.status).toBe("contested");
  });

  it("uses source_key when only one source has a key", () => {
    const r = computeVerification([ep(["A", "C"])]);
    expect(r.status).toBe("source_key");
    expect(r.correct).toEqual(["A", "C"]);
  });

  it("treats an incomplete multi-select PDF key as supporting evidence only", () => {
    const ok = computeVerification([pdf(["A"], true), ep(["A", "D"])]);
    expect(ok.status).toBe("source_key");
    expect(ok.correct).toEqual(["A", "D"]);
    const bad = computeVerification([pdf(["B"], true), ep(["A", "D"])]);
    expect(bad.status).toBe("conflict");
  });

  it("returns unknown with no claims", () => {
    expect(computeVerification([]).status).toBe("unknown");
  });

  it("lets a user override win", () => {
    const r = computeVerification([pdf(["A"]), ep(["C"]), { kind: "user_override", labels: ["C"] }]);
    expect(r.status).toBe("user_verified");
    expect(r.correct).toEqual(["C"]);
  });
});

describe("isGradable", () => {
  it("grades only verified, single-source and user-verified answers by default", () => {
    expect(isGradable("verified")).toBe(true);
    expect(isGradable("source_key")).toBe(true);
    expect(isGradable("user_verified")).toBe(true);
    expect(isGradable("contested")).toBe(false);
    expect(isGradable("conflict")).toBe(false);
    expect(isGradable("unknown")).toBe(false);
  });
  it("optionally grades contested answers", () => {
    expect(isGradable("contested", true)).toBe(true);
    expect(isGradable("conflict", true)).toBe(false);
  });
});
