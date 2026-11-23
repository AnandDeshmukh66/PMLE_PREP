/**
 * Blueprint Distribution Alignment and the official exam-guide weights it depends on. Pure functions only: callers
 * pass the version's ExamDomain rows and question counts, so pages, the verifier script and tests share one formula.
 *
 * BDA = 100 × Σ_d min(share_d, w_d), share_d = n_d / N over all unique active questions (unmapped questions count in
 * N and never match a domain), w_d = published weight_d / Σ published weights. Equivalently 100 × (1 − total
 * variation distance). It measures only how closely the bank's domain mix matches the official weights.
 */

export type GuideDomain = { number: number; title: string; weightPercent: number | null };

export type DistributionStatus = "proportional" | "over" | "under";

export type DistributionRow = {
  number: number;
  title: string;
  /** Official weight exactly as published and stored (the guide's approximate "~" integers). */
  publishedWeight: number | null;
  /** publishedWeight / Σ published weights; only used for arithmetic, never stored. */
  scaledWeight: number | null;
  count: number;
  share: number;
  /** share − scaledWeight in percentage points. */
  diffPp: number | null;
  status: DistributionStatus | null;
};

export type DistributionReason = "no_domains" | "missing_weights" | "no_questions";

export type Distribution = {
  /** Unique active questions (each counted once, whatever its sources). */
  total: number;
  /** Questions without a domain of this guide. */
  unmapped: number;
  unmappedShare: number;
  /** Σ published weights (101 for the June 2026 PMLE guide). */
  weightSum: number;
  /** 0-100, or null when it cannot be computed (see reason). */
  score: number | null;
  reason: DistributionReason | null;
  rows: DistributionRow[];
};

/** Percentage-point difference from the scaled weight within which a domain counts as proportional. */
export const PROPORTIONAL_PP = 5;

/** `byDomain` maps a domain number (as a string) to its question count; any other key (e.g. "unmapped") is unmapped. */
export function blueprintDistribution(domains: GuideDomain[], byDomain: Record<string, number>): Distribution {
  const sorted = [...domains].sort((a, b) => a.number - b.number);
  const total = Object.values(byDomain).reduce((a, n) => a + n, 0);
  const counts = sorted.map((d) => byDomain[String(d.number)] ?? 0);
  const mapped = counts.reduce((a, n) => a + n, 0);
  const unmapped = total - mapped;
  const complete = sorted.length > 0 && sorted.every((d) => d.weightPercent !== null && d.weightPercent >= 0);
  const weightSum = sorted.reduce((a, d) => a + (d.weightPercent ?? 0), 0);
  const scalable = complete && weightSum > 0;
  const rows: DistributionRow[] = sorted.map((d, i) => {
    const share = total ? counts[i] / total : 0;
    const scaled = scalable ? d.weightPercent! / weightSum : null;
    const diffPp = scaled === null ? null : (share - scaled) * 100;
    const status: DistributionStatus | null = diffPp === null || !total ? null : Math.abs(diffPp) < PROPORTIONAL_PP ? "proportional" : diffPp > 0 ? "over" : "under";
    return { number: d.number, title: d.title, publishedWeight: d.weightPercent, scaledWeight: scaled, count: counts[i], share, diffPp, status };
  });
  const reason: DistributionReason | null = !sorted.length ? "no_domains" : !scalable ? "missing_weights" : !total ? "no_questions" : null;
  const score = reason ? null : 100 * rows.reduce((a, r) => a + Math.min(r.share, r.scaledWeight!), 0);
  return { total, unmapped, unmappedShare: total ? unmapped / total : 0, weightSum, score, reason, rows };
}

/** Whole-number display that never rounds a non-perfect match up to 100. */
export function displayScore(score: number): number {
  return Math.min(100, Math.floor(score + 1e-9));
}

// ---------------------------------------------------------------- verification gate

/**
 * Parses BLUEPRINT_VERIFIED_WEIGHTS: "<versionId>=<w1>,<w2>,...[;<versionId>=...]". Each entry holds the production
 * weights (ordered by domain number) that passed the official-guide verification. Malformed entries are ignored.
 */
export function parseVerifiedWeights(raw: string | undefined | null): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const entry of (raw ?? "").split(";")) {
    const m = /^\s*([A-Za-z0-9_-]{1,64})\s*=\s*(\d{1,3}(?:\s*,\s*\d{1,3})*)\s*$/.exec(entry);
    if (m) out.set(m[1], m[2].split(",").map((w) => Number(w.trim())));
  }
  return out;
}

export type VerificationState = "verified" | "unverified" | "mismatch";

/** The score may be shown only when the version's stored weights equal its verified entry exactly. */
export function verificationState(versionId: string, domains: GuideDomain[], verified: Map<string, number[]>): VerificationState {
  const expected = verified.get(versionId);
  if (!expected) return "unverified";
  const actual = [...domains].sort((a, b) => a.number - b.number).map((d) => d.weightPercent);
  if (actual.length !== expected.length || actual.some((w, i) => w !== expected[i])) return "mismatch";
  return "verified";
}

// ---------------------------------------------------------------- official guide text

export type GuideSection = { number: number; title: string; weight: number };

/** Sections and "(~N% of the exam)" weights from the text of an official exam guide (same rule as scripts/pipeline.py). */
export function parseGuideWeights(text: string): GuideSection[] {
  const flat = text.normalize("NFKC").replace(/\u200b/g, " ").replace(/\s+/g, " ");
  const out: GuideSection[] = [];
  for (const m of flat.matchAll(/Section\s+(\d+):\s*(.+?)\s*\(~\s*(\d+)%\s*of the exam\)/g)) {
    out.push({ number: Number(m[1]), title: m[2].trim(), weight: Number(m[3]) });
  }
  return out;
}

export type WeightComparison = {
  pass: boolean;
  rows: { number: number; officialTitle: string | null; storedTitle: string | null; official: number | null; stored: number | null; weightOk: boolean; titleOk: boolean }[];
  officialSum: number;
  storedSum: number;
  problems: string[];
};

const normTitle = (t: string) => t.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

/** Official guide sections against stored ExamDomain rows: same numbers, identical published weights and matching titles. */
export function compareGuideWeights(official: GuideSection[], stored: GuideDomain[], expectedSections?: number): WeightComparison {
  const problems: string[] = [];
  const numbers = [...new Set([...official.map((s) => s.number), ...stored.map((d) => d.number)])].sort((a, b) => a - b);
  if (new Set(official.map((s) => s.number)).size !== official.length) problems.push("The guide lists a section number more than once.");
  if (expectedSections !== undefined && official.length !== expectedSections) problems.push(`Expected ${expectedSections} guide sections, found ${official.length}.`);
  if (!official.length) problems.push("No weighted sections were found in the guide.");
  const rows = numbers.map((n) => {
    const o = official.find((s) => s.number === n) ?? null;
    const d = stored.find((x) => x.number === n) ?? null;
    const weightOk = !!o && !!d && d.weightPercent === o.weight;
    const titleOk = !!o && !!d && normTitle(o.title) === normTitle(d.title);
    if (!o) problems.push(`Domain ${n} is stored but not in the guide.`);
    else if (!d) problems.push(`Guide section ${n} is missing from the stored domains.`);
    else {
      if (!weightOk) problems.push(`Domain ${n}: guide ${o.weight}%, stored ${d.weightPercent ?? "null"}%.`);
      if (!titleOk) problems.push(`Domain ${n}: title differs (guide "${o.title}", stored "${d.title}").`);
    }
    return { number: n, officialTitle: o?.title ?? null, storedTitle: d?.title ?? null, official: o?.weight ?? null, stored: d?.weightPercent ?? null, weightOk, titleOk };
  });
  return { pass: problems.length === 0, rows, officialSum: official.reduce((a, s) => a + s.weight, 0), storedSum: stored.reduce((a, d) => a + (d.weightPercent ?? 0), 0), problems };
}
