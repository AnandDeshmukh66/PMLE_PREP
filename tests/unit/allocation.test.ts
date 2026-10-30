import { describe, expect, it } from "vitest";
import { allocateByWeight, largestRemainder } from "@/lib/allocation";

const W = [
  { domain: 1, weight: 13 },
  { domain: 2, weight: 16 },
  { domain: 3, weight: 21 },
  { domain: 4, weight: 20 },
  { domain: 5, weight: 18 },
  { domain: 6, weight: 13 },
];
const plenty = { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100 };

describe("largestRemainder", () => {
  it("always sums to the requested total", () => {
    for (const n of [1, 7, 50, 60, 61, 100]) {
      const m = largestRemainder(W.map((w) => ({ key: w.domain, weight: w.weight })), n);
      expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(n);
    }
  });
});

describe("allocateByWeight", () => {
  it("allocates 60 questions by the published weights and discloses the 101% sum", () => {
    const p = allocateByWeight(W, plenty, 60);
    expect(p.total).toBe(60);
    expect(Object.fromEntries(p.domains.map((d) => [d.domain, d.allocated]))).toEqual({ 1: 8, 2: 9, 3: 12, 4: 12, 5: 11, 6: 8 });
    expect(p.disclosures.join(" ")).toMatch(/101%/);
  });

  it("redistributes a shortfall to domains with spare questions and discloses it", () => {
    const p = allocateByWeight(W, { ...plenty, 5: 4 }, 60, "redistribute");
    expect(p.total).toBe(60);
    const d5 = p.domains.find((d) => d.domain === 5)!;
    expect(d5.allocated).toBe(4);
    expect(d5.shortfall).toBe(7);
    expect(p.domains.reduce((a, d) => a + d.extra, 0)).toBe(7);
    expect(p.disclosures.some((d) => d.includes("Domain 5"))).toBe(true);
  });

  it("shrinks the exam when configured", () => {
    const p = allocateByWeight(W, { ...plenty, 5: 4 }, 60, "shrink");
    expect(p.total).toBe(53);
    expect(p.disclosures.some((d) => d.includes("53 questions instead of 60"))).toBe(true);
  });

  it("never allocates more than is available", () => {
    const p = allocateByWeight(W, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2 }, 60);
    expect(p.total).toBe(12);
    for (const d of p.domains) expect(d.allocated).toBeLessThanOrEqual(d.available);
  });
});
