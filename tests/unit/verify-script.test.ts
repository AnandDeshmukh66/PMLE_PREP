import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareGuideWeights, parseGuideWeights } from "@/lib/blueprint";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = fs.readFileSync(path.join(ROOT, "scripts/verify-exam-weights.ts"), "utf8");
const guide = () => parseGuideWeights(fs.readFileSync(path.join(ROOT, "data/raw/guide/guide.txt"), "utf8"));
const stored = () => guide().map((s) => ({ number: s.number, title: s.title, weightPercent: s.weight }));

describe("verify-exam-weights script", () => {
  it("only reads from the database", () => {
    const code = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Prisma model calls look like `db.model.verb(`; `createHash(…).update(` (hashing) is not a database call.
    for (const call of [/\w\.(create|createMany|createManyAndReturn)\s*\(/, /\w\.(update|updateMany|updateManyAndReturn)\s*\(/, /\w\.(delete|deleteMany)\s*\(/, /\.upsert\s*\(/, /\$execute/, /\$queryRaw/, /\$transaction/, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\s/]) {
      expect(code, String(call)).not.toMatch(call);
    }
    expect(code).toMatch(/\.findMany\(/);
    expect(code).not.toMatch(/writeFileSync\([^)]*ROOT/);
  });
});

describe("compareGuideWeights", () => {
  it("passes when weights and titles are identical, keeping the published total", () => {
    const r = compareGuideWeights(guide(), stored(), 6);
    expect(r.pass).toBe(true);
    expect(r.officialSum).toBe(101);
    expect(r.storedSum).toBe(101);
    expect(r.rows.map((x) => x.stored)).toEqual([13, 16, 21, 20, 18, 13]);
  });

  it("flags a different weight, a missing or extra domain, a null weight, a title change and a wrong section count", () => {
    const changed = stored().map((d) => (d.number === 4 ? { ...d, weightPercent: 19 } : d));
    expect(compareGuideWeights(guide(), changed, 6)).toMatchObject({ pass: false, problems: ["Domain 4: guide 20%, stored 19%."] });
    expect(compareGuideWeights(guide(), stored().slice(0, 5), 6).problems).toEqual(["Guide section 6 is missing from the stored domains."]);
    expect(compareGuideWeights(guide(), [...stored(), { number: 7, title: "Extra", weightPercent: 0 }], 6).problems).toEqual(["Domain 7 is stored but not in the guide."]);
    expect(compareGuideWeights(guide(), stored().map((d) => (d.number === 1 ? { ...d, weightPercent: null } : d)), 6).pass).toBe(false);
    expect(compareGuideWeights(guide(), stored().map((d) => (d.number === 2 ? { ...d, title: "Something else" } : d)), 6).problems[0]).toMatch(/^Domain 2: title differs/);
    expect(compareGuideWeights(guide().slice(0, 5), stored().slice(0, 5), 6).problems).toEqual(["Expected 6 guide sections, found 5."]);
    expect(compareGuideWeights([], [], 6).pass).toBe(false);
  });

  it("ignores typographic differences in titles", () => {
    const fancy = stored().map((d) => ({ ...d, title: `  ${d.title.replace(/-/g, "\u2013")}  ` }));
    expect(compareGuideWeights(guide(), fancy, 6).pass).toBe(true);
  });
});
