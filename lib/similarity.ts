export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9%/+#.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient on character bigrams (0..1). */
export function dice(a: string, b: string): number {
  const x = normalizeForMatch(a);
  const y = normalizeForMatch(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [g, c] of bx) inter += Math.min(c, by.get(g) ?? 0);
  return (2 * inter) / (x.length - 1 + (y.length - 1));
}

/** Map each source option label to the most similar canonical option label (null if below threshold). */
export function mapOptionLabels(
  source: { label: string; text: string }[],
  canonical: { label: string; text: string }[],
  threshold = 0.6,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const o of source) {
    let best: string | null = null;
    let bestScore = 0;
    for (const c of canonical) {
      const s = dice(o.text, c.text);
      if (s > bestScore) {
        bestScore = s;
        best = c.label;
      }
    }
    out[o.label] = bestScore >= threshold ? best : null;
  }
  return out;
}
