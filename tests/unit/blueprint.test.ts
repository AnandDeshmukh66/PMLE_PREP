import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blueprintDistribution, displayScore, parseGuideWeights, parseVerifiedWeights, verificationState, type GuideDomain } from "@/lib/blueprint";
import { neutralSourceLabels, neutralSourceRef } from "@/lib/cert-rules";
import { displaySessionTitle, isSourceId, learnerFilters, neutralSessionConfig, scopeFromParam, stripSourceQuery } from "@/lib/filters";

// Test fixture only: the June 2026 PMLE guide as published (13/16/21/20/18/13, total 101).
const PUBLISHED = [13, 16, 21, 20, 18, 13];
const domains = (weights: (number | null)[]): GuideDomain[] => weights.map((w, i) => ({ number: i + 1, title: `Domain ${i + 1}`, weightPercent: w }));
const counts = (ns: number[], unmapped = 0) => Object.fromEntries([...ns.map((n, i) => [String(i + 1), n]), ...(unmapped ? [["unmapped", unmapped]] : [])]);

describe("blueprintDistribution", () => {
  it("scores a perfect match 100 and a disjoint mix 0", () => {
    expect(blueprintDistribution(domains([50, 50]), counts([10, 10])).score).toBeCloseTo(100, 9);
    expect(displayScore(blueprintDistribution(domains([50, 50]), counts([10, 10])).score!)).toBe(100);
    expect(blueprintDistribution(domains([100, 0]), counts([0, 10])).score).toBeCloseTo(0, 9);
  });

  it("reproduces the plan's illustration (local data) and floors the display", () => {
    const d = blueprintDistribution(domains(PUBLISHED), counts([56, 103, 67, 41, 32, 38], 2));
    expect(d.total).toBe(339);
    expect(d.unmapped).toBe(2);
    expect(d.score!).toBeGreaterThan(81.1);
    expect(d.score!).toBeLessThan(81.3);
    expect(displayScore(d.score!)).toBe(81);
    expect(d.rows.map((r) => Math.round(r.diffPp! * 10) / 10)).toEqual([3.6, 14.5, -1.0, -7.7, -8.4, -1.7]);
    expect(d.rows.map((r) => r.status)).toEqual(["proportional", "over", "proportional", "under", "under", "proportional"]);
  });

  it("treats unmapped questions as misaligned mass", () => {
    const without = blueprintDistribution(domains(PUBLISHED), counts([56, 103, 67, 41, 32, 38])).score!;
    const withUnmapped = blueprintDistribution(domains(PUBLISHED), counts([56, 103, 67, 41, 32, 38], 2)).score!;
    expect(withUnmapped).toBeLessThan(without);
    expect(without).toBeCloseTo(81.5, 0);
    // Domain numbers the guide does not have also count as unmapped.
    expect(blueprintDistribution(domains([50, 50]), { "1": 5, "2": 5, "9": 10 }).unmapped).toBe(10);
  });

  it("keeps published weights unchanged and scales only in memory", () => {
    const input = domains(PUBLISHED);
    const d = blueprintDistribution(input, counts([1, 1, 1, 1, 1, 1]));
    expect(d.rows.map((r) => r.publishedWeight)).toEqual(PUBLISHED);
    expect(input.map((x) => x.weightPercent)).toEqual(PUBLISHED);
    expect(d.weightSum).toBe(101);
    expect(d.rows.reduce((a, r) => a + r.scaledWeight!, 0)).toBeCloseTo(1, 12);
    expect(d.rows[0].scaledWeight).toBeCloseTo(13 / 101, 12);
  });

  it("returns no score, with a reason, when it cannot be computed", () => {
    expect(blueprintDistribution(domains([13, null, 21]), counts([1, 1, 1]))).toMatchObject({ score: null, reason: "missing_weights" });
    expect(blueprintDistribution(domains([0, 0]), counts([1, 1]))).toMatchObject({ score: null, reason: "missing_weights" });
    expect(blueprintDistribution(domains(PUBLISHED), {})).toMatchObject({ score: null, reason: "no_questions", total: 0 });
    expect(blueprintDistribution([], counts([3]))).toMatchObject({ score: null, reason: "no_domains" });
    const nulls = blueprintDistribution(domains([null, null]), counts([1, 1]));
    expect(nulls.rows.every((r) => r.scaledWeight === null && r.diffPp === null && r.status === null)).toBe(true);
  });

  it("orders rows by domain number whatever the input order", () => {
    const d = blueprintDistribution([...domains(PUBLISHED)].reverse(), counts([1, 2, 3, 4, 5, 6]));
    expect(d.rows.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(d.rows.map((r) => r.count)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("verification gate", () => {
  const verified = parseVerifiedWeights("ver_pmle_2026=13,16,21,20,18,13; ver_other = 50,50");

  it("parses entries and ignores malformed ones", () => {
    expect(verified.get("ver_pmle_2026")).toEqual(PUBLISHED);
    expect(verified.get("ver_other")).toEqual([50, 50]);
    expect(parseVerifiedWeights(undefined).size).toBe(0);
    expect(parseVerifiedWeights("").size).toBe(0);
    expect(parseVerifiedWeights("garbage").size).toBe(0);
    expect(parseVerifiedWeights("v=13,x,21").size).toBe(0);
    expect(parseVerifiedWeights("v=1.5,2").size).toBe(0);
    expect(parseVerifiedWeights("bad id!=1,2;ok=3").get("ok")).toEqual([3]);
  });

  it("passes only on an exact match, in domain order", () => {
    expect(verificationState("ver_pmle_2026", domains(PUBLISHED), verified)).toBe("verified");
    expect(verificationState("ver_pmle_2026", [...domains(PUBLISHED)].reverse(), verified)).toBe("verified");
    expect(verificationState("ver_new", domains(PUBLISHED), verified)).toBe("unverified");
    expect(verificationState("ver_pmle_2026", domains([13, 16, 21, 20, 18, 12]), verified)).toBe("mismatch");
    expect(verificationState("ver_pmle_2026", domains([16, 13, 21, 20, 18, 13]), verified)).toBe("mismatch");
    expect(verificationState("ver_pmle_2026", domains([13, 16, 21, 20, 18]), verified)).toBe("mismatch");
    expect(verificationState("ver_pmle_2026", domains([13, 16, 21, 20, 18, null]), verified)).toBe("mismatch");
  });
});

describe("parseGuideWeights", () => {
  it("reads the six sections of the stored official guide text, including a title spanning two lines", () => {
    const text = fs.readFileSync(path.resolve(__dirname, "../../data/raw/guide/guide.txt"), "utf8");
    const s = parseGuideWeights(text);
    expect(s.map((x) => x.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.map((x) => x.weight)).toEqual(PUBLISHED);
    expect(s[1].title).toBe("Collaborating within and across teams to manage data and models");
    expect(s[0].title).toBe("Architecting low-code AI solutions");
  });

  it("returns nothing for text without weights", () => {
    expect(parseGuideWeights("Section 1: Something without a weight")).toEqual([]);
  });
});

describe("neutral source labels", () => {
  it("labels one source 'Source' and several 'Source 1…N' in the given order", () => {
    expect([...neutralSourceLabels(["pdf"]).values()]).toEqual([{ index: 1, label: "Source", short: "S" }]);
    const two = neutralSourceLabels(["pdf", "examprepper"]);
    expect(two.get("pdf")).toEqual({ index: 1, label: "Source 1", short: "S1" });
    expect(two.get("examprepper")).toEqual({ index: 2, label: "Source 2", short: "S2" });
    expect([...neutralSourceLabels(["a", "b", "c"]).values()].map((l) => l.label)).toEqual(["Source 1", "Source 2", "Source 3"]);
    expect(neutralSourceLabels([]).size).toBe(0);
  });

  it("builds backup aliases that can never collide with a real source id or key", () => {
    expect(neutralSourceRef(1, "pdf:84", "pdf")).toBe("#1:84");
    expect(neutralSourceRef(2, "examprepper:136", "examprepper")).toBe("#2:136");
    expect(neutralSourceRef(3, "my-src:12:a", "my-src")).toBe("#3:12:a");
    for (const alias of ["#1:84", "#2:136"]) {
      expect(isSourceId(alias.split(":")[0])).toBe(false);
      expect(alias).not.toMatch(/pdf|examprepper/);
    }
  });
});

describe("list scopes", () => {
  it("maps former source and common list contexts to All Questions", () => {
    for (const v of ["pdf", "examprepper", "common", "source:pdf", "source:x", "constructor", "__proto__", "", undefined, null]) expect(scopeFromParam(v)).toBe("all");
    for (const v of ["all", "marked", "flagged", "incorrect", "bookmarked"] as const) expect(scopeFromParam(v)).toBe(v);
  });
});

describe("learner filters and titles", () => {
  it("drops source filters and source sorts for learners only", () => {
    const f = { q: "x", source: "only:pdf", sort: "qnum:pdf", domain: [2] };
    expect(learnerFilters(f, true)).toEqual(f);
    expect(learnerFilters(f, false)).toEqual({ q: "x", domain: [2] });
    expect(learnerFilters({ sort: "recent", source: "common" }, false)).toEqual({ sort: "recent" });
  });

  it("strips source parameters from stored list queries", () => {
    expect(stripSourceQuery("domain=2&source=only%3Apdf&sort=qnum%3Apdf")).toBe("domain=2");
    expect(stripSourceQuery("sort=pdf_qnum&q=bigquery")).toBe("q=bigquery");
    expect(stripSourceQuery("sort=recent")).toBe("sort=recent");
  });

  it("neutralises titles of sessions started from a source or common list for learners only", () => {
    const cfg = JSON.stringify({ mode: "custom", scope: "source:pdf", query: "domain=1" });
    expect(displaySessionTitle("PDF question bank Questions (filtered)", cfg, false)).toBe("All Questions (filtered)");
    expect(displaySessionTitle("ExamPrepper Questions", { scope: "source:examprepper" }, false)).toBe("All Questions");
    expect(displaySessionTitle("Common Questions", { scope: "common" }, false)).toBe("All Questions");
    expect(displaySessionTitle("PDF question bank Questions", cfg, true)).toBe("PDF question bank Questions");
    expect(displaySessionTitle("Domain practice · Domain 2", { mode: "domain", domains: [2] }, false)).toBe("Domain practice · Domain 2");
    expect(displaySessionTitle("Marked for Review", "not json", false)).toBe("Marked for Review");
  });

  it("removes source scopes and queries from session configs", () => {
    expect(JSON.parse(neutralSessionConfig(JSON.stringify({ mode: "custom", scope: "source:pdf", query: "source=only:pdf&domain=1", seed: 3 })) as string)).toEqual({
      mode: "custom",
      scope: "all",
      query: "domain=1",
      seed: 3,
    });
    expect(neutralSessionConfig("{bad")).toBe("{bad");
  });
});
