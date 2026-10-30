import { allocateByWeight, type AllocationPlan } from "./allocation";
import { LEGACY_FLAGGED } from "./filters";
import type { QuestionStats } from "./stats";

export type SelectableRow = {
  id: number;
  code: string;
  domainNumber: number | null;
  alignmentScore: number;
  verification: string;
  gradable: boolean;
  legacyStatus: string;
  isCommon: boolean;
  multiSelect: boolean;
  conceptIds: string[];
  marked: boolean;
  flagged: boolean;
  stats: Pick<QuestionStats, "attempts" | "graded" | "correctAttempts" | "latestCorrect" | "incorrectCount" | "lastAttemptAt">;
};

export type PracticeMode = "all" | "common" | "domain" | "topic" | "incorrect" | "unattempted" | "flagged" | "marked" | "high_alignment" | "weak_area";

export const PRACTICE_MODES: Record<PracticeMode, { title: string; description: string }> = {
  all: { title: "All questions", description: "Practice the full unique bank." },
  common: { title: "Common questions", description: "Questions present in both sources." },
  domain: { title: "Domain practice", description: "Pick one or more official exam domains." },
  topic: { title: "Topic practice", description: "Pick one or more theory concepts." },
  incorrect: { title: "Incorrect questions", description: "Retry questions whose latest graded attempt was wrong." },
  unattempted: { title: "Unattempted", description: "Only questions you have never attempted." },
  flagged: { title: "Flagged", description: "Questions you flagged." },
  marked: { title: "Marked for review", description: "Questions you marked for review." },
  high_alignment: { title: "High alignment", description: "Questions scoring ≥ 0.75 against the June 2026 guide." },
  weak_area: { title: "Weak areas", description: "Topics with accuracy below 70% after at least 3 graded attempts." },
};

export type PracticeConfig = {
  mode: PracticeMode;
  count: number;
  shuffle: boolean;
  immediateFeedback: boolean;
  includeAttempted: boolean;
  includeUnverified: boolean;
  domains?: number[];
  concepts?: string[];
  seed?: number;
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const rnd = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type ConceptPerf = { conceptId: string; graded: number; correct: number; accuracy: number };

export function conceptPerformance(rows: SelectableRow[]): Map<string, ConceptPerf> {
  const m = new Map<string, ConceptPerf>();
  for (const r of rows) {
    for (const c of r.conceptIds) {
      const p = m.get(c) ?? { conceptId: c, graded: 0, correct: 0, accuracy: 0 };
      p.graded += r.stats.graded;
      p.correct += r.stats.correctAttempts;
      m.set(c, p);
    }
  }
  for (const p of m.values()) p.accuracy = p.graded ? p.correct / p.graded : 0;
  return m;
}

export function selectPractice(rows: SelectableRow[], cfg: PracticeConfig): { ids: number[]; note: string | null; poolSize: number } {
  let pool = rows;
  let note: string | null = null;
  switch (cfg.mode) {
    case "common":
      pool = pool.filter((r) => r.isCommon);
      break;
    case "domain":
      pool = pool.filter((r) => r.domainNumber !== null && (cfg.domains ?? []).includes(r.domainNumber));
      break;
    case "topic":
      pool = pool.filter((r) => r.conceptIds.some((c) => (cfg.concepts ?? []).includes(c)));
      break;
    case "incorrect":
      pool = pool.filter((r) => r.stats.latestCorrect === false);
      break;
    case "unattempted":
      pool = pool.filter((r) => r.stats.attempts === 0);
      break;
    case "flagged":
      pool = pool.filter((r) => r.flagged);
      break;
    case "marked":
      pool = pool.filter((r) => r.marked);
      break;
    case "high_alignment":
      pool = pool.filter((r) => r.alignmentScore >= 0.75);
      break;
    case "weak_area": {
      const perf = [...conceptPerformance(rows).values()].filter((p) => p.graded >= 3 && p.accuracy < 0.7).sort((a, b) => a.accuracy - b.accuracy);
      if (!perf.length) {
        note = "Not enough history yet: weak-area practice needs topics with at least 3 graded attempts and accuracy below 70%. Showing unattempted and incorrect questions instead.";
        pool = pool.filter((r) => r.stats.attempts === 0 || r.stats.latestCorrect === false);
      } else {
        const weak = new Map(perf.map((p, i) => [p.conceptId, i]));
        pool = pool
          .filter((r) => r.conceptIds.some((c) => weak.has(c)))
          .sort((a, b) => {
            const ra = Math.min(...a.conceptIds.map((c) => weak.get(c) ?? 999));
            const rb = Math.min(...b.conceptIds.map((c) => weak.get(c) ?? 999));
            const pa = a.stats.latestCorrect === true ? 1 : 0;
            const pb = b.stats.latestCorrect === true ? 1 : 0;
            return pa - pb || ra - rb;
          });
        note = `Weak topics: ${perf.slice(0, 5).map((p) => `${p.conceptId} (${Math.round(p.accuracy * 100)}%)`).join(", ")}`;
      }
      break;
    }
  }
  if (cfg.mode !== "domain" && cfg.domains?.length) pool = pool.filter((r) => r.domainNumber !== null && cfg.domains!.includes(r.domainNumber));
  if (!cfg.includeAttempted && cfg.mode !== "incorrect") pool = pool.filter((r) => r.stats.attempts === 0);
  if (!cfg.includeUnverified) pool = pool.filter((r) => r.gradable);
  const poolSize = pool.length;
  let ordered = pool;
  if (cfg.shuffle && cfg.mode !== "weak_area") ordered = shuffleSeeded(pool, cfg.seed ?? Date.now());
  else if (cfg.mode === "high_alignment") ordered = [...pool].sort((a, b) => b.alignmentScore - a.alignmentScore);
  return { ids: ordered.slice(0, Math.max(1, cfg.count)).map((r) => r.id), note, poolSize };
}

export type MockOptions = {
  total: number;
  fallback: "redistribute" | "shrink";
  excludeLegacy: boolean;
  onlyGradable: boolean;
  seed: number;
};

export function selectMock(rows: SelectableRow[], weights: { domain: number; weight: number }[], opts: MockOptions): { ids: number[]; plan: AllocationPlan & { excluded: Record<string, number> } } {
  const excluded = { unmapped: 0, legacy: 0, unverified: 0 };
  const eligible = rows.filter((r) => {
    if (r.domainNumber === null) return excluded.unmapped++, false;
    if (opts.excludeLegacy && LEGACY_FLAGGED.has(r.legacyStatus)) return excluded.legacy++, false;
    if (opts.onlyGradable && !r.gradable) return excluded.unverified++, false;
    return true;
  });
  const byDomain = new Map<number, SelectableRow[]>();
  for (const r of eligible) (byDomain.get(r.domainNumber!) ?? byDomain.set(r.domainNumber!, []).get(r.domainNumber!)!).push(r);
  const available = Object.fromEntries(weights.map((w) => [w.domain, byDomain.get(w.domain)?.length ?? 0]));
  const plan = allocateByWeight(weights, available, opts.total, opts.fallback);
  const rnd = mulberry32(opts.seed);
  const picked: SelectableRow[] = [];
  for (const d of plan.domains) {
    const scored = (byDomain.get(d.domain) ?? []).map((r) => ({
      r,
      s: 0.45 * r.alignmentScore + 0.25 * (r.verification === "verified" || r.verification === "user_verified" ? 1 : 0) + 0.1 * (r.legacyStatus === "current" || r.legacyStatus === "renamed_terminology" ? 1 : 0) + 0.35 * rnd(),
    }));
    scored.sort((a, b) => b.s - a.s);
    picked.push(...scored.slice(0, d.allocated).map((x) => x.r));
  }
  const ids = shuffleSeeded(
    picked.map((r) => r.id),
    opts.seed + 1,
  );
  return { ids, plan: { ...plan, excluded } };
}
