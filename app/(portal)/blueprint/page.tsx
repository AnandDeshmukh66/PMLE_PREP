import Link from "next/link";
import { Badge, Card, PageHeader, ProgressBar } from "@/components/ui";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { loadQuestionRows } from "@/lib/questions";
import { DOMAIN_COLOR, pct } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

export default async function BlueprintPage() {
  const user = await requireUser();
  const [domains, concepts, rows] = await Promise.all([
    prisma.examDomain.findMany({ orderBy: { number: "asc" }, include: { objectives: { orderBy: { order: "asc" } } } }),
    prisma.theoryConcept.findMany({ include: { progress: { where: { userId: user.id } } } }).then((cs) => cs.map((c) => ({ ...c, progress: c.progress[0] ?? null }))),
    loadQuestionRows(user.id),
  ]);
  const totalW = domains.reduce((a, d) => a + (d.weightPercent ?? 0), 0);
  const mapped = rows.filter((r) => r.domainNumber !== null).length;

  return (
    <div className="animate-in">
      <PageHeader
        title="Exam Blueprint"
        description="Professional Machine Learning Engineer exam guide, effective June 1, 2026. Weights are as published (they sum to 101%). Coverage shows how the question bank and your preparation map onto each objective."
      />
      <Card className="mb-6 p-5">
        <div className="mb-3 text-xs font-medium text-fg-2">Exam weight vs. question bank share</div>
        <div className="flex h-3 overflow-hidden rounded-full" aria-label="Official weights">
          {domains.map((d) => (
            <div key={d.number} style={{ width: `${((d.weightPercent ?? 0) / totalW) * 100}%`, background: DOMAIN_COLOR[d.number] }} title={`Domain ${d.number}: ${d.weightPercent}%`} />
          ))}
        </div>
        <div className="mt-1.5 flex h-3 overflow-hidden rounded-full opacity-60" aria-label="Question bank share">
          {domains.map((d) => (
            <div key={d.number} style={{ width: `${(rows.filter((r) => r.domainNumber === d.number).length / Math.max(1, mapped)) * 100}%`, background: DOMAIN_COLOR[d.number] }} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
          {domains.map((d) => {
            const n = rows.filter((r) => r.domainNumber === d.number).length;
            const share = n / Math.max(1, mapped);
            const diff = share * 100 - (d.weightPercent ?? 0);
            return (
              <a key={d.number} href={`#dom-${d.number}`} className="rounded-lg p-1.5 hover:bg-white/[0.03]">
                <div className="flex items-center gap-1.5 text-fg-2">
                  <span className="size-2 rounded-full" style={{ background: DOMAIN_COLOR[d.number] }} />
                  Domain {d.number}
                </div>
                <div className="text-muted">
                  Exam {d.weightPercent}% · Bank {pct(share)}
                </div>
                <div className={Math.abs(diff) >= 5 ? (diff > 0 ? "text-accent" : "text-warn") : "text-faint"}>{Math.abs(diff) < 5 ? "Proportional" : diff > 0 ? "Over-represented" : "Under-represented"}</div>
              </a>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] text-faint">Top bar: official weights. Lower bar: share of the classified question bank. Under-represented domains need extra theory study beyond the available questions.</p>
      </Card>

      <div className="flex flex-col gap-6">
        {domains.map((d) => {
          const dRows = rows.filter((r) => r.domainNumber === d.number);
          const dCon = concepts.filter((c) => c.domainNumber === d.number);
          const dDone = dCon.filter((c) => c.progress?.status === "completed").length;
          const graded = dRows.filter((r) => r.stats.latestCorrect !== null);
          return (
            <section key={d.number} id={`dom-${d.number}`} className="scroll-mt-6">
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4" style={{ boxShadow: `inset 3px 0 0 ${DOMAIN_COLOR[d.number]}` }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium tracking-[0.06em] text-muted uppercase">Domain {d.number}</div>
                    <h2 className="text-base font-semibold text-fg">{d.title}</h2>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-semibold tabular-nums text-fg">{d.weightPercent}%</div>
                    <div className="text-[11px] text-faint">of the exam</div>
                  </div>
                  <div className="grid w-full grid-cols-3 gap-4 text-xs sm:w-auto sm:min-w-[360px]">
                    <Link href={`/questions?domain=${d.number}`} className="hover:text-accent">
                      <div className="text-faint">Questions</div>
                      <div className="text-fg-2">{dRows.length}</div>
                    </Link>
                    <Link href="/theory" className="hover:text-accent">
                      <div className="text-faint">Theory</div>
                      <div className="text-fg-2">
                        {dDone}/{dCon.length}
                      </div>
                    </Link>
                    <div>
                      <div className="text-faint">Accuracy</div>
                      <div className="text-fg-2">{graded.length ? pct(graded.filter((r) => r.stats.latestCorrect).length / graded.length) : "-"}</div>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-line">
                  {d.objectives.map((o) => {
                    const oRows = rows.filter((r) => r.objectiveCode === o.code);
                    const oCon = concepts.filter((c) => c.objectiveCode === o.code);
                    const oDone = oCon.filter((c) => c.progress?.status === "completed").length;
                    const og = oRows.filter((r) => r.stats.latestCorrect !== null);
                    const cons = parseJson<string[]>(o.considerations, []);
                    return (
                      <div key={o.code} id={`obj-${o.code}`} className="grid scroll-mt-6 gap-4 px-5 py-4 lg:grid-cols-[1fr_260px]">
                        <div>
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-xs text-accent">{o.code}</span>
                            <h3 className="text-[13.5px] font-medium text-fg">{o.title}</h3>
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
                          <div className="mt-2.5 flex flex-wrap gap-1">
                            {oCon.slice(0, 14).map((c) => (
                              <Link key={c.id} href={`/theory/${c.id}`} className={`rounded-md px-1.5 py-0.5 text-[11px] ${c.progress?.status === "completed" ? "bg-ok-soft text-ok" : "bg-white/[0.04] text-fg-2 hover:text-accent"}`}>
                                {c.name}
                              </Link>
                            ))}
                            {oCon.length > 14 && <Badge tone="outline">+{oCon.length - 14} more</Badge>}
                          </div>
                        </div>
                        <div className="space-y-2.5 text-xs">
                          <div>
                            <div className="mb-1 flex justify-between text-muted">
                              <Link href={`/questions?objective=${o.code}`} className="hover:text-accent">
                                {oRows.length} questions
                              </Link>
                              <span>{oRows.filter((r) => r.stats.attempts).length} attempted</span>
                            </div>
                            <ProgressBar value={oRows.length ? oRows.filter((r) => r.stats.attempts).length / oRows.length : 0} />
                          </div>
                          <div>
                            <div className="mb-1 flex justify-between text-muted">
                              <span>Theory</span>
                              <span>
                                {oDone}/{oCon.length}
                              </span>
                            </div>
                            <ProgressBar value={oCon.length ? oDone / oCon.length : 0} tone="ok" />
                          </div>
                          <div className="flex justify-between text-muted">
                            <span>Latest accuracy</span>
                            <span className="text-fg-2">{og.length ? pct(og.filter((r) => r.stats.latestCorrect).length / og.length) : "-"}</span>
                          </div>
                          {oRows.length > 0 && (
                            <Link href={`/questions?objective=${o.code}`} className="inline-block text-accent hover:underline">
                              Browse questions →
                            </Link>
                          )}
                          {oRows.length === 0 && <div className="text-warn">No questions in the bank. Study from documentation.</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </section>
          );
        })}
      </div>
    </div>
  );
}
