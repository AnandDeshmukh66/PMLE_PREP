import { describe, expect, it } from "vitest";
import { buildGroups, formatCode } from "@/lib/canonicalize";
import { parseFilters, filtersToParams } from "@/lib/filters";
import { dice, mapOptionLabels } from "@/lib/similarity";

const occ = (k: string) => {
  const [sourceId, n] = k.split(":");
  return { sourceKey: k, sourceId, sourceQnum: Number(n) };
};

describe("buildGroups", () => {
  const occs = ["pdf:1", "pdf:2", "pdf:3", "examprepper:10", "examprepper:11", "examprepper:12"].map(occ);

  it("clusters confirmed and approved pairs transitively and ignores rejected ones", () => {
    const g = buildGroups(occs, [
      { aKey: "pdf:1", bKey: "examprepper:10", status: "auto_confirmed" },
      { aKey: "pdf:2", bKey: "examprepper:11", status: "approved" },
      { aKey: "pdf:3", bKey: "examprepper:12", status: "rejected" },
      { aKey: "pdf:3", bKey: "examprepper:11", status: "auto_rejected" },
      { aKey: "pdf:2", bKey: "examprepper:12", status: "pending" },
    ]);
    expect(g).toEqual([["pdf:1", "examprepper:10"], ["pdf:2", "examprepper:11"], ["pdf:3"], ["examprepper:12"]]);
  });

  it("keeps the unique count consistent with PDF + web − overlap", () => {
    const g = buildGroups(occs, [
      { aKey: "pdf:1", bKey: "examprepper:10", status: "auto_confirmed" },
      { aKey: "pdf:2", bKey: "examprepper:11", status: "auto_confirmed" },
    ]);
    const overlap = g.filter((x) => x.some((k) => k.startsWith("pdf")) && x.some((k) => k.startsWith("examprepper"))).length;
    expect(g.length).toBe(3 + 3 - overlap);
  });

  it("is order-independent", () => {
    const pairs = [
      { aKey: "pdf:1", bKey: "examprepper:10", status: "auto_confirmed" },
      { aKey: "examprepper:10", bKey: "examprepper:11", status: "approved" },
    ];
    expect(buildGroups(occs, pairs)).toEqual(buildGroups([...occs].reverse(), [...pairs].reverse()));
  });
});

describe("similarity", () => {
  it("maps reordered options by text", () => {
    const a = [
      { label: "A", text: "Use Dataflow to preprocess the data" },
      { label: "B", text: "Use BigQuery ML" },
    ];
    const b = [
      { label: "A", text: "Use BigQuery ML." },
      { label: "B", text: "Use Dataflow to pre-process the data" },
    ];
    expect(mapOptionLabels(a, b)).toEqual({ A: "B", B: "A" });
    expect(dice("same text", "Same   text")).toBe(1);
  });
});

describe("codes and filters", () => {
  it("formats stable canonical codes", () => {
    expect(formatCode(7)).toBe("Q-0007");
  });
  it("round-trips filters through URL params", () => {
    const f = parseFilters({ q: "pdf 84", domain: "2,3", flagged: "1", verification: "unverified", sort: "alignment_desc" });
    expect(parseFilters(Object.fromEntries(filtersToParams(f)))).toEqual(f);
  });
});
