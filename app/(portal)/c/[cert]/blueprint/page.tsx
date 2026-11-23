import Link from "next/link";
import { BlueprintShare } from "@/components/blueprint-share";
import { Badge, Card, PageHeader } from "@/components/ui";
import { blueprintDistribution } from "@/lib/blueprint";
import { certPage } from "@/lib/cert";
import { inCert } from "@/lib/cert-rules";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { domainColor } from "@/lib/utils";

/** The official exam guide: weights as published, objectives and considerations. Personal progress lives in Analytics. */
export default async function BlueprintPage({ params }: { params: Promise<{ cert: string }> }) {
  const { cert, base, version } = await certPage(params);
  const L = (h: string) => inCert(base, h);
  const [domains, concepts, byDomain, byObjective] = await Promise.all([
    prisma.examDomain.findMany({ where: { versionId: version.id }, orderBy: { number: "asc" }, include: { objectives: { orderBy: { order: "asc" } } } }),
    prisma.theoryConcept.findMany({ where: { versionId: version.id }, select: { id: true, name: true, objectiveCode: true } }),
    prisma.canonicalQuestion.groupBy({ by: ["domainNumber"], where: { versionId: version.id, active: true }, _count: true }),
    prisma.canonicalQuestion.groupBy({ by: ["objectiveCode"], where: { versionId: version.id, active: true }, _count: true }),
  ]);
  const dist = blueprintDistribution(
    domains,
    Object.fromEntries(byDomain.map((r) => [String(r.domainNumber ?? "unmapped"), r._count])),
  );
  const perObjective = new Map(byObjective.map((r) => [r.objectiveCode, r._count]));

  return (
    <div className="animate-in">
      <PageHeader
        title="Exam Blueprint"
        description={`${cert.name} · ${version.guideTitle ?? `version ${version.label}`}. Weights are as published (they sum to ${dist.weightSum}%).`}
        actions={
          <Link href={L("/analytics")} className="text-xs text-accent hover:underline" data-testid="progress-link">
            Your progress by domain → Analytics
          </Link>
        }
      />
      {dist.rows.length > 0 && <BlueprintShare dist={dist} className="mb-6" note="Under-represented domains need extra theory study beyond the available questions." />}

      <div className="flex flex-col gap-5">
        {domains.map((d) => (
          <section key={d.number} id={`dom-${d.number}`} className="scroll-mt-6">
            <Card className="overflow-hidden">
              <div className="flex items-center gap-4 border-b border-line px-5 py-3.5" style={{ boxShadow: `inset 3px 0 0 ${domainColor(d.number)}` }}>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium tracking-[0.06em] text-muted uppercase">Domain {d.number}</div>
                  <h2 className="text-base font-semibold text-fg">{d.title}</h2>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold tabular-nums text-fg" data-testid={`weight-${d.number}`}>
                    {d.weightPercent === null ? "n/a" : `${d.weightPercent}%`}
                  </div>
                  <div className="text-[11px] text-faint">of the exam</div>
                </div>
              </div>
              <div className="divide-y divide-line">
                {d.objectives.map((o) => {
                  const cons = parseJson<string[]>(o.considerations, []);
                  const oCon = concepts.filter((c) => c.objectiveCode === o.code);
                  const n = perObjective.get(o.code) ?? 0;
                  return (
                    <div key={o.code} id={`obj-${o.code}`} className="scroll-mt-6 px-5 py-3.5">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-xs text-accent">{o.code}</span>
                        <h3 className="min-w-0 flex-1 text-[13.5px] font-medium text-fg">{o.title}</h3>
                        {n > 0 ? (
                          <Link href={L(`/questions?objective=${o.code}`)} className="text-xs text-muted hover:text-accent">
                            {n} questions →
                          </Link>
                        ) : (
                          <span className="text-xs text-warn">No questions in the bank. Study from documentation.</span>
                        )}
                      </div>
                      {cons.length > 0 && (
                        <ul className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted md:grid-cols-2">
                          {cons.map((c, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-line-2" />
                              {c}
                            </li>
                          ))}
                        </ul>
                      )}
                      {oCon.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {oCon.slice(0, 14).map((c) => (
                            <Link key={c.id} href={L(`/theory/${c.id}`)} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-fg-2 hover:text-accent">
                              {c.name}
                            </Link>
                          ))}
                          {oCon.length > 14 && <Badge tone="outline">+{oCon.length - 14} more</Badge>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
