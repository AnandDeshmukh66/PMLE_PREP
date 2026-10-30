import { describe, expect, it } from "vitest";
import { selectMock, selectPractice, shuffleSeeded, type SelectableRow } from "@/lib/selection";

function row(id: number, over: Partial<SelectableRow> = {}): SelectableRow {
  return {
    id,
    code: `Q-${String(id).padStart(4, "0")}`,
    domainNumber: ((id - 1) % 6) + 1,
    alignmentScore: (id % 10) / 10,
    verification: "verified",
    gradable: true,
    legacyStatus: "current",
    isCommon: id % 2 === 0,
    multiSelect: false,
    conceptIds: [`c${id % 5}`],
    marked: false,
    flagged: false,
    stats: { attempts: 0, graded: 0, correctAttempts: 0, latestCorrect: null, incorrectCount: 0, lastAttemptAt: null },
    ...over,
  };
}
const rows = Array.from({ length: 240 }, (_, i) => row(i + 1));
const base = { count: 20, shuffle: true, immediateFeedback: true, includeAttempted: true, includeUnverified: true, seed: 42 };

describe("selectPractice", () => {
  it("is deterministic for a seed and respects the count", () => {
    const a = selectPractice(rows, { ...base, mode: "all" });
    const b = selectPractice(rows, { ...base, mode: "all" });
    expect(a.ids).toEqual(b.ids);
    expect(a.ids).toHaveLength(20);
    expect(new Set(a.ids).size).toBe(20);
  });

  it("filters by domain, common and incorrect", () => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(selectPractice(rows, { ...base, mode: "domain", domains: [3] }).ids.every((id) => byId.get(id)!.domainNumber === 3)).toBe(true);
    expect(selectPractice(rows, { ...base, mode: "common" }).ids.every((id) => byId.get(id)!.isCommon)).toBe(true);
    const withWrong = rows.map((r) => (r.id <= 5 ? { ...r, stats: { ...r.stats, attempts: 1, graded: 1, latestCorrect: false, incorrectCount: 1 } } : r));
    expect(selectPractice(withWrong, { ...base, mode: "incorrect" }).ids.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });

  it("excludes unverified questions when asked", () => {
    const mixed = rows.map((r) => (r.id % 3 === 0 ? { ...r, gradable: false, verification: "conflict" } : r));
    const byId = new Map(mixed.map((r) => [r.id, r]));
    expect(selectPractice(mixed, { ...base, mode: "all", count: 200, includeUnverified: false }).ids.every((id) => byId.get(id)!.gradable)).toBe(true);
  });

  it("falls back with an explanation when there is no weak-area history", () => {
    const r = selectPractice(rows, { ...base, mode: "weak_area" });
    expect(r.note).toMatch(/Not enough history/);
  });
});

describe("selectMock", () => {
  const weights = [13, 16, 21, 20, 18, 13].map((weight, i) => ({ domain: i + 1, weight }));

  it("draws 60 unique questions matching the allocation", () => {
    const { ids, plan } = selectMock(rows, weights, { total: 60, fallback: "redistribute", excludeLegacy: true, onlyGradable: true, seed: 7 });
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const d of plan.domains) expect(ids.filter((id) => byId.get(id)!.domainNumber === d.domain)).toHaveLength(d.allocated);
  });

  it("excludes legacy, unverified and unmapped questions and reports how many", () => {
    const mixed = rows.map((r) => (r.id % 4 === 0 ? { ...r, legacyStatus: "deprecated_feature" } : r.id % 4 === 1 ? { ...r, gradable: false } : r));
    mixed.push(row(999, { domainNumber: null }));
    const { ids, plan } = selectMock(mixed, weights, { total: 60, fallback: "redistribute", excludeLegacy: true, onlyGradable: true, seed: 7 });
    const byId = new Map(mixed.map((r) => [r.id, r]));
    expect(ids.every((id) => byId.get(id)!.gradable && byId.get(id)!.legacyStatus === "current")).toBe(true);
    expect(plan.excluded).toEqual({ unmapped: 1, legacy: 60, unverified: 60 });
  });
});

describe("shuffleSeeded", () => {
  it("is a deterministic permutation", () => {
    const a = shuffleSeeded([1, 2, 3, 4, 5, 6, 7, 8], 3);
    expect(a).toEqual(shuffleSeeded([1, 2, 3, 4, 5, 6, 7, 8], 3));
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
