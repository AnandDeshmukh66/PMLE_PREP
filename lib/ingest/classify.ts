import { normText } from "./normalize";

export type ObjectiveProfile = { code: string; title: string; considerations: string[] };
export type ConceptProfile = { id: string; objectiveCode: string; name: string; keywords: string[] };
export type Classification = {
  status: "mapped" | "unmapped";
  primary_objective: string | null;
  secondary_objectives: string[];
  concepts: string[];
  matched_terms: Record<string, string[]>;
  alignment: number;
  alignment_band: "strong" | "moderate" | "weak";
  confidence: "high" | "medium" | "low";
  confidence_value: number;
  explanation: string;
  evidence: string | null;
};

/** Objective mapping behind one interface, so a different (for example AI-assisted) classifier can replace it. */
export interface Classifier {
  classify(text: string): Classification;
}

const STOP = new Set("a an and are as at be by can for from has have how in into is it its of on or that the their this to use used using what when which while will with you your should would could does do not all any each more most must other such than then there these they those through within without".split(" "));
const stemWord = (w: string) => w.replace(/(?:ies)$/, "y").replace(/(?:ing|ed|es|s)$/, "");
const terms = (s: string) =>
  normText(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stemWord);

/**
 * Keyword classifier: scores each objective by IDF-weighted term overlap with its title and considerations, plus
 * strong evidence from concept keyword phrases. Results below a minimum score stay unmapped for manual review.
 */
export function keywordClassifier(objectives: ObjectiveProfile[], concepts: ConceptProfile[]): Classifier {
  const docs = objectives.map((o) => ({ code: o.code, terms: new Set(terms([o.title, ...o.considerations].join(" "))) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log(1 + docs.length / (df.get(t) ?? docs.length));
  const phrases = concepts.map((c) => ({ ...c, phrases: [c.name, ...c.keywords].map((k) => normText(k)).filter((k) => k.length >= 3) }));
  const known = new Set(objectives.map((o) => o.code));

  return {
    classify(text) {
      if (!docs.length) return unmapped("This version has no exam objectives yet, so questions cannot be mapped.");
      const qTerms = new Set(terms(text));
      const norm = ` ${normText(text)} `;
      const scores = new Map<string, number>();
      const matched: Record<string, string[]> = {};
      for (const d of docs) {
        let s = 0;
        for (const t of qTerms) if (d.terms.has(t)) s += idf(t);
        scores.set(d.code, s);
      }
      const conceptHits: { id: string; score: number }[] = [];
      for (const c of phrases) {
        const hits = c.phrases.filter((p) => norm.includes(` ${p} `));
        if (!hits.length) continue;
        matched[c.id] = hits.slice(0, 6);
        conceptHits.push({ id: c.id, score: hits.length });
        if (known.has(c.objectiveCode)) scores.set(c.objectiveCode, (scores.get(c.objectiveCode) ?? 0) + 3 * hits.length);
      }
      const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
      const [top, second] = ranked;
      if (!top || top[1] < 2) return unmapped("Too few exam-guide terms matched to choose an objective.");
      const margin = second ? (top[1] - second[1]) / top[1] : 1;
      const confidence_value = Math.round(Math.min(1, (top[1] / 12) * 0.6 + margin * 0.4) * 100) / 100;
      const confidence = confidence_value >= 0.7 ? "high" : confidence_value >= 0.45 ? "medium" : "low";
      const alignment = Math.round(Math.min(1, top[1] / 10) * 100) / 100;
      return {
        status: "mapped",
        primary_objective: top[0],
        secondary_objectives: ranked
          .slice(1, 3)
          .filter(([, s]) => s >= top[1] * 0.7)
          .map(([c]) => c),
        concepts: conceptHits
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map((c) => c.id),
        matched_terms: matched,
        alignment,
        alignment_band: alignment >= 0.6 ? "strong" : alignment >= 0.3 ? "moderate" : "weak",
        confidence,
        confidence_value,
        explanation: `Keyword match against objective ${top[0]} (score ${top[1].toFixed(1)}${second ? `, next ${second[0]} ${second[1].toFixed(1)}` : ""}).`,
        evidence: Object.values(matched).flat().slice(0, 8).join(", ") || null,
      };
    },
  };
}

function unmapped(explanation: string): Classification {
  return { status: "unmapped", primary_objective: null, secondary_objectives: [], concepts: [], matched_terms: {}, alignment: 0, alignment_band: "weak", confidence: "low", confidence_value: 0, explanation, evidence: null };
}
