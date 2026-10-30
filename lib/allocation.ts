export type WeightedBucket = { key: number; weight: number };

/** Hamilton / largest-remainder apportionment of `total` seats across weights. */
export function largestRemainder(buckets: WeightedBucket[], total: number): Map<number, number> {
  const sum = buckets.reduce((a, b) => a + b.weight, 0);
  const out = new Map<number, number>();
  if (sum <= 0 || total <= 0) {
    buckets.forEach((b) => out.set(b.key, 0));
    return out;
  }
  const quotas = buckets.map((b) => ({ key: b.key, q: (b.weight / sum) * total }));
  let assigned = 0;
  for (const { key, q } of quotas) {
    out.set(key, Math.floor(q));
    assigned += Math.floor(q);
  }
  const order = [...quotas].sort((a, b) => b.q - Math.floor(b.q) - (a.q - Math.floor(a.q)) || a.key - b.key);
  for (let i = 0; assigned < total; i = (i + 1) % order.length) {
    out.set(order[i].key, (out.get(order[i].key) ?? 0) + 1);
    assigned++;
  }
  return out;
}

export type DomainAllocation = {
  domain: number;
  weight: number;
  quota: number;
  idealShare: number;
  available: number;
  allocated: number;
  shortfall: number;
  extra: number;
};

export type AllocationPlan = {
  total: number;
  requested: number;
  fallback: "redistribute" | "shrink";
  domains: DomainAllocation[];
  disclosures: string[];
};

/**
 * Allocate exam questions by approximate official weights. If a domain lacks eligible
 * questions, the shortfall is disclosed and either redistributed by weight to domains with
 * spare questions (default) or the exam is shortened. Nothing is filled from outside the
 * eligible pool.
 */
export function allocateByWeight(
  weights: { domain: number; weight: number }[],
  available: Record<number, number>,
  requested: number,
  fallback: "redistribute" | "shrink" = "redistribute",
): AllocationPlan {
  const sumW = weights.reduce((a, w) => a + w.weight, 0);
  const quotas = largestRemainder(weights.map((w) => ({ key: w.domain, weight: w.weight })), requested);
  const domains: DomainAllocation[] = weights.map((w) => {
    const quota = quotas.get(w.domain) ?? 0;
    const avail = available[w.domain] ?? 0;
    const allocated = Math.min(quota, avail);
    return { domain: w.domain, weight: w.weight, quota, idealShare: (w.weight / sumW) * requested, available: avail, allocated, shortfall: quota - allocated, extra: 0 };
  });
  const disclosures: string[] = [];
  if (sumW !== 100) disclosures.push(`The official weights are approximate and sum to ${sumW}%, so quotas are scaled proportionally to ${requested} questions.`);
  let missing = domains.reduce((a, d) => a + d.shortfall, 0);
  for (const d of domains) {
    if (d.shortfall > 0) disclosures.push(`Domain ${d.domain}: only ${d.available} eligible questions for a quota of ${d.quota} (shortfall ${d.shortfall}).`);
  }
  if (missing > 0 && fallback === "redistribute") {
    while (missing > 0) {
      const spare = domains.filter((d) => d.available > d.allocated);
      if (!spare.length) break;
      const add = largestRemainder(spare.map((d) => ({ key: d.domain, weight: d.weight })), missing);
      let placed = 0;
      for (const d of spare) {
        const want = add.get(d.domain) ?? 0;
        const can = Math.min(want, d.available - d.allocated);
        d.allocated += can;
        d.extra += can;
        placed += can;
      }
      if (!placed) break;
      missing -= placed;
    }
    const moved = domains.filter((d) => d.extra > 0).map((d) => `domain ${d.domain} +${d.extra}`).join(", ");
    if (moved) disclosures.push(`Shortfall redistributed by weight to domains with spare questions: ${moved}.`);
  }
  const total = domains.reduce((a, d) => a + d.allocated, 0);
  if (total < requested) disclosures.push(`The exam has ${total} questions instead of ${requested} because the eligible pool is too small.`);
  return { total, requested, fallback, domains, disclosures };
}
