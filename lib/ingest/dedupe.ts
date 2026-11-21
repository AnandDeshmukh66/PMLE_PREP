import { dice, mapOptionLabels } from "../similarity";
import { normText } from "./normalize";

export type DedupeItem = { sourceKey: string; sourceId: string; stem: string; options: { label: string; text: string }[]; answer: string[]; contentHash: string };
export type DuplicatePair = {
  a: string;
  b: string;
  stage: "exact" | "fuzzy";
  score: number;
  stemRatio: number;
  optionSim: number;
  numberMismatch: string[];
  answersAgree: boolean;
  decision: "auto_confirmed" | "pending";
  reason: string;
};

const STOP = new Set(["the", "and", "for", "you", "your", "with", "that", "this", "are", "what", "which", "should", "from", "will", "have", "need", "want", "using", "use", "can", "not", "all", "how", "into", "their", "they", "them", "its", "has", "was", "but", "our"]);
const tokens = (s: string) => new Set(normText(s).split(" ").filter((t) => t.length >= 4 && !STOP.has(t)));
const numbers = (s: string) => new Set(nfNums(s));
const nfNums = (s: string) => s.match(/\d+(?:[.,]\d+)?%?/g) ?? [];

function optionSimilarity(a: DedupeItem["options"], b: DedupeItem["options"]): number {
  if (!a.length || !b.length) return a.length === b.length ? 100 : 0;
  const m = a.map((x) => b.map((y) => dice(x.text, y.text)));
  const s1 = m.reduce((s, row) => s + Math.max(...row), 0) / a.length;
  const s2 = b.reduce((s, _y, j) => s + Math.max(...a.map((_x, i) => m[i][j])), 0) / b.length;
  return Math.round(Math.min(s1, s2) * 1000) / 10;
}

function answersAgree(a: DedupeItem, b: DedupeItem): boolean {
  if (!a.answer.length || !b.answer.length) return true;
  const map = mapOptionLabels(a.options, b.options);
  const mapped = a.answer.map((l) => map[l]).filter(Boolean).sort();
  return mapped.length === a.answer.length && mapped.join(",") === [...b.answer].sort().join(",");
}

/**
 * Exact and near-duplicate candidates between `fresh` items and everything in `pool` (which includes `fresh`).
 * Exact matches and close cross-source matches with agreeing answers merge automatically; everything uncertain
 * (same-source look-alikes, differing numbers, disagreeing answers) is left pending for a reviewer.
 */
export function findDuplicates(fresh: DedupeItem[], pool: DedupeItem[]): DuplicatePair[] {
  const tok = new Map(pool.map((p) => [p.sourceKey, tokens(p.stem)]));
  const index = new Map<string, string[]>();
  for (const p of pool) for (const t of tok.get(p.sourceKey)!) (index.get(t) ?? index.set(t, []).get(t)!).push(p.sourceKey);
  const byKey = new Map(pool.map((p) => [p.sourceKey, p]));
  const out = new Map<string, DuplicatePair>();
  for (const a of fresh) {
    const ta = tok.get(a.sourceKey)!;
    const shared = new Map<string, number>();
    for (const t of ta) {
      const posting = index.get(t)!;
      if (posting.length > 400) continue;
      for (const k of posting) if (k !== a.sourceKey) shared.set(k, (shared.get(k) ?? 0) + 1);
    }
    for (const p of pool) if (p.sourceKey !== a.sourceKey && p.contentHash === a.contentHash) shared.set(p.sourceKey, Number.MAX_SAFE_INTEGER);
    for (const [k, n] of shared) {
      const b = byKey.get(k)!;
      const [x, y] = a.sourceKey < b.sourceKey ? [a, b] : [b, a];
      const pairKey = `${x.sourceKey}|${y.sourceKey}`;
      if (out.has(pairKey)) continue;
      const tb = tok.get(k)!;
      if (n !== Number.MAX_SAFE_INTEGER && n < 0.5 * Math.min(ta.size, tb.size)) continue;
      const sameSource = x.sourceId === y.sourceId;
      if (x.contentHash === y.contentHash) {
        out.set(pairKey, { a: x.sourceKey, b: y.sourceKey, stage: "exact", score: 100, stemRatio: 100, optionSim: 100, numberMismatch: [], answersAgree: answersAgree(x, y), decision: "auto_confirmed", reason: sameSource ? "Identical question repeated within the source" : "Identical stem and options" });
        continue;
      }
      const stemRatio = Math.round(dice(x.stem, y.stem) * 1000) / 10;
      if (stemRatio < 80) continue;
      const optionSim = optionSimilarity(x.options, y.options);
      const nx = numbers(x.stem + " " + x.options.map((o) => o.text).join(" "));
      const ny = numbers(y.stem + " " + y.options.map((o) => o.text).join(" "));
      const numberMismatch = [...new Set([...nx].filter((v) => !ny.has(v)).concat([...ny].filter((v) => !nx.has(v))))].slice(0, 10);
      const agree = answersAgree(x, y);
      const strong = stemRatio >= 90 && optionSim >= 85;
      if (!strong && optionSim < 70) continue;
      const auto = strong && !numberMismatch.length && agree && !sameSource;
      const why = auto
        ? "Near-identical stem and options from different sources; answers agree"
        : [sameSource ? "same source (possible variant)" : null, numberMismatch.length ? "numbers differ" : null, agree ? null : "answers differ", strong ? null : "similar but not near-identical"].filter(Boolean).join("; ");
      out.set(pairKey, { a: x.sourceKey, b: y.sourceKey, stage: "fuzzy", score: Math.round((stemRatio * 0.6 + optionSim * 0.4) * 10) / 10, stemRatio, optionSim, numberMismatch, answersAgree: agree, decision: auto ? "auto_confirmed" : "pending", reason: why });
    }
  }
  return [...out.values()];
}
