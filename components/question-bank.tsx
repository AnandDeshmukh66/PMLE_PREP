import Link from "next/link";
import { Suspense } from "react";
import { Image as ImageIcon, MessageSquare } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { filtersToParams, parseFilters, SCOPES, type Scope } from "@/lib/filters";
import { filterRows, loadQuestionRows } from "@/lib/questions";
import { DOMAIN_SHORT, pct } from "@/lib/utils";
import { AlignmentBadge, DomainBadge, LegacyBadge, OutcomeDot, SourceBadges, VerificationBadge } from "./badges";
import { BankActions } from "./bank-actions";
import { FilterBar } from "./filter-bar";
import { RowActions } from "./row-actions";
import { Badge, Card, EmptyState, PageHeader } from "./ui";

type SP = Record<string, string | string[] | undefined>;

export async function QuestionBank({ scope, searchParams }: { scope: Scope; searchParams: SP }) {
  const filters = parseFilters(searchParams);
  const user = await requireUser();
  const all = await loadQuestionRows(user.id);
  const rows = filterRows(all, scope, filters);
  const scopeTotal = filterRows(all, scope, {}).length;
  const params = filtersToParams(filters);
  const query = params.toString();
  const concept = filters.concept ? await prisma.theoryConcept.findUnique({ where: { id: filters.concept }, select: { name: true } }) : null;
  const meta = SCOPES[scope];
  const linkQuery = new URLSearchParams(params);
  linkQuery.set("from", scope);
  const gradedRows = rows.filter((r) => r.stats.graded > 0);
  const listAcc = gradedRows.length ? gradedRows.filter((r) => r.stats.latestCorrect).length / gradedRows.length : null;
  const clearKind = scope === "marked" ? "review" : scope === "flagged" ? "flag" : scope === "bookmarked" ? "bookmark" : undefined;

  return (
    <div className="animate-in">
      <PageHeader
        crumbs={[{ label: "Question bank", href: "/questions" }, { label: meta.title }]}
        title={meta.title}
        description={meta.description}
        actions={<BankActions scope={scope} query={query} ids={rows.map((r) => r.id)} clearKind={clearKind} />}
      />
      <Suspense>
        <FilterBar conceptName={concept?.name} hideSource={scope === "common"} />
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
                <Link href={`/questions/${r.code}?${linkQuery.toString()}`} className="min-w-0 flex-1 outline-none" data-testid={`open-${r.code}`}>
                  <span className="absolute inset-0" aria-hidden />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11.5px] font-medium text-fg-2">{r.code}</span>
                    <DomainBadge domain={r.domainNumber} objective={r.objectiveCode} />
                    <AlignmentBadge score={r.alignmentScore} band={r.alignmentBand} />
                    <VerificationBadge status={r.verification} compact />
                    <LegacyBadge status={r.legacyStatus} />
                    {r.multiSelect && <Badge tone="violet">Multi-select</Badge>}
                    {r.isCommon && scope !== "common" && <Badge tone="outline">Common</Badge>}
                    {r.hasImages && <ImageIcon className="size-3.5 text-faint" aria-label="Has exhibit" />}
                    {r.noteCount > 0 && <MessageSquare className="size-3.5 text-faint" aria-label="Has notes" />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-fg-2 group-hover:text-fg">{r.stem.replace(/\[\[img:\d+\]\]/g, "[exhibit]")}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                    <SourceBadges refs={r.refs} />
                    {r.subtopic && <span className="truncate">{r.subtopic}</span>}
                    {r.domainNumber && <span className="hidden md:inline">{DOMAIN_SHORT[r.domainNumber]}</span>}
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
