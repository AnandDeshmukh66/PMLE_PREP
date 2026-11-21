import crypto from "node:crypto";
import { normalizeForMatch } from "./similarity";

export const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

type Opt = { label: string; text: string };

/** Identity of a question's learner-facing content: same stem, options and key => same hash. */
export function questionContentHash(stem: string, options: Opt[], correct: string[] | null): string {
  const body = [normalizeForMatch(stem), ...options.map((o) => `${o.label}:${normalizeForMatch(o.text)}`), `key:${(correct ?? []).join(",")}`].join("\n");
  return sha256(body).slice(0, 32);
}

export type FingerprintInput = {
  questions: { code: string; stem: string; multiSelect: boolean; selectCount: number; verification: string; correctLabels: string | null; objectiveCode: string | null; options: Opt[] }[];
  objectives: { code: string; domainNumber: number; title: string; considerations: string }[];
  domains: { number: number; title: string; weightPercent: number | null }[];
  concepts: { id: string; name: string; objectiveCode: string }[];
};

/** Deterministic content fingerprint of a version (order-independent). Any learner-visible change alters it. */
export function contentFingerprint(f: FingerprintInput): string {
  const by = <T>(xs: T[], k: (x: T) => string) => [...xs].sort((a, b) => k(a).localeCompare(k(b)));
  const doc = {
    domains: by(f.domains, (d) => String(d.number).padStart(4, "0")).map((d) => [d.number, d.title, d.weightPercent]),
    objectives: by(f.objectives, (o) => o.code).map((o) => [o.code, o.domainNumber, o.title, o.considerations]),
    concepts: by(f.concepts, (c) => c.id).map((c) => [c.id, c.name, c.objectiveCode]),
    questions: by(f.questions, (q) => q.code).map((q) => [q.code, q.stem, q.multiSelect, q.selectCount, q.verification, q.correctLabels, q.objectiveCode, q.options.map((o) => [o.label, o.text])]),
  };
  return sha256(JSON.stringify(doc));
}
