import Link from "next/link";
import { Suspense } from "react";
import { Image as ImageIcon, MessageSquare } from "lucide-react";
import { certPage, versionDomains } from "@/lib/cert";
import { inCert } from "@/lib/cert-rules";
import { prisma } from "@/lib/db";
import { filtersToParams, learnerFilters, parseFilters, type Scope, scopeMeta } from "@/lib/filters";
import { filterRows, loadQuestionRows, versionSources } from "@/lib/questions";
import { domainShort, pct } from "@/lib/utils";
import { AlignmentBadge, DomainBadge, LegacyBadge, OutcomeDot, SourceBadges, VerificationBadge } from "./badges";
import { BankActions } from "./bank-actions";
import { FilterBar } from "./filter-bar";
import { RowActions } from "./row-actions";
import { Badge, Card, EmptyState, PageHeader } from "./ui";

type SP = Record<string, string | string[] | undefined>;

export async function QuestionBank({ params: routeParams, scope, searchParams }: { params: Promise<{ cert: string }>; scope: Scope; searchParams: SP }) {
  const { user, base, version } = await certPage(routeParams);
  const L = (h: string) => inCert(base, h);
  const admin = user.isAdmin;
  const filters = learnerFilters(parseFilters(searchParams), admin);
  const [all, sources, domains] = await Promise.all([loadQuestionRows(user.id, version.id), admin ? versionSources(version.id) : [], versionDomains(version.id)]);
  const rows = filterRows(all, scope, filters, { sourceSearch: admin });
  const scopeTotal = filterRows(all, scope, {}).length;
  const params = filtersToParams(filters);
  const query = params.toString();
  const concept = filters.concept ? await prisma.theoryConcept.findUnique({ where: { versionId_id: { versionId: version.id, id: filters.concept } }, select: { name: true } }) : null;
  const meta = scopeMeta(scope);
  const linkQuery = new URLSearchParams(params);
  linkQuery.set("from", scope);
  const gradedRows = rows.filter((r) => r.stats.graded > 0);
  const listAcc = gradedRows.length ? gradedRows.filter((r) => r.stats.latestCorrect).length / gradedRows.length : null;
  const clearKind = scope === "marked" ? "review" : scope === "flagged" ? "flag" : scope === "bookmarked" ? "bookmark" : undefined;

  return (
    <div className="animate-in">
      <PageHeader
        crumbs={[{ label: "Questions & Review", href: L("/questions") }, { label: meta.title }]}
        title={meta.title}
        description={meta.description}
        actions={<BankActions scope={scope} query={query} ids={rows.map((r) => r.id)} clearKind={clearKind} />}
      />
      <Suspense>
        <FilterBar conceptName={concept?.name} />
      </Suspense>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span data-testid="result-count">
          {rows.length} of {scopeTotal} questions
          {gradedRows.length > 0 && (
            <>
              {" "}
              · latest accuracy {pct(listAcc)} on {gradedRows.length} graded
            </>
          )}
        </span>
        <span className="hidden sm:inline">Open a question to practice it. Changes sync across every view.</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No questions match" description={scope === "all" ? "Try clearing some filters." : "Nothing here yet. Questions appear here as you mark, flag or answer them."} />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {rows.map((r) => {
            const acc = r.stats.graded ? r.stats.correctAttempts / r.stats.graded : null;
            return (
              <div key={r.id} id={r.code} className="group relative flex scroll-mt-24 items-start gap-3 px-4 py-3 transition-colors hover:bg-white/[0.02]" data-testid="question-row">
                <div className="pt-1.5">
                  <OutcomeDot outcome={r.stats.latestOutcome} />
                </div>
                <Link href={L(`/questions/${r.code}?${linkQuery.toString()}`)} className="min-w-0 flex-1 outline-none" data-testid={`open-${r.code}`}>
                  <span className="absolute inset-0" aria-hidden />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11.5px] font-medium text-fg-2">{r.code}</span>
                    <DomainBadge domain={r.domainNumber} objective={r.objectiveCode} title={r.domainNumber ? domains[r.domainNumber] : undefined} />
                    <AlignmentBadge score={r.alignmentScore} band={r.alignmentBand} />
                    <VerificationBadge status={r.verification} compact />
                    <LegacyBadge status={r.legacyStatus} />
                    {r.multiSelect && <Badge tone="violet">Multi-select</Badge>}
                    {admin && r.isCommon && <Badge tone="outline">Common</Badge>}
                    {r.hasImages && <ImageIcon className="size-3.5 text-faint" aria-label="Has exhibit" />}
                    {r.noteCount > 0 && <MessageSquare className="size-3.5 text-faint" aria-label="Has notes" />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-fg-2 group-hover:text-fg">{r.stem.replace(/\[\[img:\d+\]\]/g, "[exhibit]")}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                    {admin && <SourceBadges refs={r.refs} sources={sources} />}
                    {r.subtopic && <span className="truncate">{r.subtopic}</span>}
                    {r.domainNumber && <span className="hidden md:inline">{domainShort(domains[r.domainNumber], 28)}</span>}
                    {r.stats.attempts > 0 && (
                      <span>
                        {r.stats.attempts} attempt{r.stats.attempts > 1 ? "s" : ""}
                        {acc !== null && ` · ${pct(acc)}`}
                        {r.stats.mastered && " · mastered"}
                      </span>
                    )}
                    {r.flagReason && <span className="text-warn">⚑ {r.flagReason}</span>}
                  </div>
                </Link>
                <div className="relative z-10 shrink-0">
                  <RowActions questionId={r.id} code={r.code} initial={{ marked: r.marked, flagged: r.flagged, bookmarked: r.bookmarked }} />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
