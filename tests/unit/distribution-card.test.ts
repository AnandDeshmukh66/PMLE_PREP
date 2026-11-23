import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlueprintShare } from "@/components/blueprint-share";
import { DistributionCard } from "@/components/distribution-card";
import { blueprintDistribution, parseGuideWeights, parseVerifiedWeights, verificationState } from "@/lib/blueprint";

const ROOT = path.resolve(__dirname, "../..");
const guide = parseGuideWeights(fs.readFileSync(path.join(ROOT, "data/raw/guide/guide.txt"), "utf8"));
const domains = guide.map((s) => ({ number: s.number, title: s.title, weightPercent: s.weight }));
const counts = { "1": 56, "2": 103, "3": 67, "4": 41, "5": 32, "6": 38, unmapped: 2 };
const dist = blueprintDistribution(domains, counts);
const weights = domains.map((d) => d.weightPercent).join(",");

function render(env: string | undefined, versionId = "ver_x") {
  const state = verificationState(versionId, domains, parseVerifiedWeights(env));
  return renderToStaticMarkup(createElement(DistributionCard, { dist, state }));
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Blueprint Distribution Alignment card", () => {
  it("shows the named score with the unique count and disclaimer only when the version's weights are verified", () => {
    const html = render(`ver_x=${weights}`);
    const t = text(html);
    expect(html).toContain('data-state="verified"');
    expect(t).toContain("Blueprint Distribution Alignment");
    expect(t).toMatch(/\b81 \/ 100\b/);
    expect(html).toMatch(/title="81\.\d \/ 100"/);
    expect(t).toContain("Domain mix of 339 unique questions (2 unmapped)");
    expect(t).toContain("It does not measure exam readiness, content completeness, answer accuracy or question quality.");
    expect(t).toContain("Official weights verified");
    expect(t).toContain("100 × Σ min(share, weight)");
  });

  it("shows no number when weights are unverified, and keeps the unique count", () => {
    for (const env of [undefined, "", "garbage", `other_version=${weights}`]) {
      const html = render(env);
      expect(html).toContain('data-state="unverified"');
      expect(html).not.toContain("bda-score");
      expect(text(html)).toContain("Unavailable: weights not yet verified against the official exam guide.");
      expect(text(html)).toContain("339 unique questions");
      expect(text(html)).not.toMatch(/\d+ \/ 100/);
    }
  });

  it("shows no number when the stored weights differ from the verified entry", () => {
    for (const env of ["ver_x=13,16,21,19,18,13", "ver_x=13,16,21,20,18", "ver_x=13,16,21,20,18,13,1"]) {
      const html = render(env);
      expect(html).toContain('data-state="mismatch"');
      expect(html).not.toContain("bda-score");
      expect(text(html)).toContain("weights differ from the verified official values");
      expect(text(html)).toContain("339 unique questions");
    }
  });

  it("explains instead of scoring when the version has no guide, missing weights or no questions", () => {
    const noGuide = renderToStaticMarkup(createElement(DistributionCard, { dist: blueprintDistribution([], counts), state: "verified" }));
    expect(text(noGuide)).toContain("This version has no exam guide");
    const missing = blueprintDistribution(domains.map((d) => (d.number === 3 ? { ...d, weightPercent: null } : d)), counts);
    expect(text(renderToStaticMarkup(createElement(DistributionCard, { dist: missing, state: "verified" })))).toContain("Domain 3 has no published weight");
    const empty = renderToStaticMarkup(createElement(DistributionCard, { dist: blueprintDistribution(domains, {}), state: "verified" }));
    expect(text(empty)).toContain("this version has no questions yet");
    expect(empty).not.toContain("bda-score");
  });
});

describe("BlueprintShare", () => {
  it("shows published weights as stored, shares over all unique questions and an Unmapped segment", () => {
    const t = text(renderToStaticMarkup(createElement(BlueprintShare, { dist })));
    for (const d of domains) expect(t).toContain(`Exam ${d.weightPercent}%`);
    expect(t).toContain("Bank 30%"); // 103 / 339
    expect(t).toContain("Unmapped");
    expect(t).toContain("all 339 unique questions");
    expect(t).not.toMatch(/Alignment|\/ 100/);
  });

  it("omits the Unmapped segment when every question is mapped", () => {
    const { unmapped: _u, ...mapped } = counts;
    void _u;
    expect(text(renderToStaticMarkup(createElement(BlueprintShare, { dist: blueprintDistribution(domains, mapped) })))).not.toContain("Unmapped");
  });
});
