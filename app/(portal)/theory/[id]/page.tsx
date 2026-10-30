import Link from "next/link";
import { notFound } from "next/navigation";
import { Play } from "lucide-react";
import { AlignmentBadge, OutcomeDot, VerificationBadge } from "@/components/badges";
import { ConceptEditor } from "@/components/theory-board";
import { Card, CardHeader, LinkButton, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { loadQuestionRows } from "@/lib/questions";
import { DOMAIN_SHORT, pct } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

export default async function ConceptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const found = await prisma.theoryConcept.findUnique({ where: { id }, include: { progress: { where: { userId: user.id } } } });
  if (!found) notFound();
  const c = { ...found, progress: found.progress[0] ?? null };
  const [objective, domain, rows] = await Promise.all([
    prisma.examObjective.findUnique({ where: { code: c.objectiveCode } }),
    prisma.examDomain.findUnique({ where: { number: c.domainNumber } }),
    loadQuestionRows(user.id),
  ]);
  const linked = rows.filter((r) => r.conceptIds.includes(id));
  const graded = linked.filter((r) => r.stats.latestCorrect !== null);
  const correct = graded.filter((r) => r.stats.latestCorrect).length;
  const considerations = parseJson<string[]>(objective?.considerations ?? "[]", []);
  const keywords = parseJson<string[]>(c.keywords, []).map((k) => k.split(":")[0].replace(/\\b|\\s\+|\\/g, "").replace(/[()?|^$]/g, " ").trim());

  return (
    <div className="animate-in">
      <PageHeader
        crumbs={[{ label: "Theory Checklist", href: "/theory" }, { label: `Domain ${c.domainNumber}` }, { label: c.name }]}
        title={c.name}
        description={c.description}
        actions={
          linked.length > 0 && (
            <LinkButton href={`/practice?mode=topic&concept=${id}&count=${Math.min(20, linked.length)}`} variant="primary" size="sm">
              <Play className="size-3.5" /> Practice {Math.min(20, linked.length)} questions
            </LinkButton>
          )
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <Stat label="Linked questions" value={linked.length} />
        </Card>
        <Card className="p-4">
          <Stat label="Attempted" value={linked.filter((r) => r.stats.attempts).length} />
        </Card>
        <Card className="p-4">
          <Stat label="Latest accuracy" value={graded.length ? pct(correct / graded.length) : "-"} hint={`${correct}/${graded.length} graded`} />
        </Card>
        <Card className="p-4">
          <Stat label="Priority" value={<span className="capitalize">{c.priority}</span>} hint={`${c.guideStatus} in the guide`} />
        </Card>
      </div>
      <div className="mb-5 max-w-md">
        <ConceptEditor
          item={{
            id: c.id,
            name: c.name,
            description: c.description,
            domain: c.domainNumber,
            objective: c.objectiveCode,
            objectiveTitle: objective?.title ?? "",
            secondary: parseJson<string[]>(c.secondaryObjectives, []),
            category: c.category,
            priority: c.priority,
            guideStatus: c.guideStatus,
            status: c.progress?.status ?? "not_started",
            confidence: c.progress?.confidence ?? null,
            notes: c.progress?.notes ?? "",
            updatedAt: c.progress?.updatedAt.toISOString() ?? null,
            questionCount: linked.length,
            attempted: linked.filter((r) => r.stats.attempts).length,
            accuracy: graded.length ? correct / graded.length : null,
          }}
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Linked practice questions" subtitle="Questions whose stem or options match this concept" />
          {linked.length === 0 ? (
            <p className="px-5 pb-5 text-xs text-muted">No question in the bank covers this concept. Study it from the official documentation; it is a coverage gap in the sources.</p>
          ) : (
            <div className="divide-y divide-line">
              {linked.map((r) => (
                <Link key={r.id} href={`/questions/${r.code}?concept=${id}`} className="flex items-center gap-3 px-5 py-2.5 text-xs hover:bg-white/[0.02]">
                  <OutcomeDot outcome={r.stats.latestCorrect === null ? (r.stats.attempts ? "ungraded" : null) : r.stats.latestCorrect ? "correct" : "incorrect"} />
                  <span className="font-mono text-fg-2">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{r.stem.replace(/\[\[img:\d+\]\]/g, "")}</span>
                  <AlignmentBadge score={r.alignmentScore} band={r.alignmentBand} />
                  <VerificationBadge status={r.verification} />
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Official guide mapping" />
          <div className="space-y-3 px-5 pb-5 text-xs">
            <div>
              <div className="text-faint">Domain</div>
              <div className="text-fg-2">
                {c.domainNumber} · {domain?.title ?? DOMAIN_SHORT[c.domainNumber]} ({domain?.weightPercent}%)
              </div>
            </div>
            <div>
              <div className="text-faint">Objective</div>
              <Link href={`/blueprint#obj-${c.objectiveCode}`} className="text-fg-2 hover:text-accent">
                {c.objectiveCode} {objective?.title}
              </Link>
            </div>
            {parseJson<string[]>(c.secondaryObjectives, []).length > 0 && (
              <div>
                <div className="text-faint">Also relevant to</div>
                <div className="text-fg-2">{parseJson<string[]>(c.secondaryObjectives, []).join(", ")}</div>
              </div>
            )}
            {considerations.length > 0 && (
              <div>
                <div className="mb-1 text-faint">Considerations listed under this objective</div>
                <ul className="list-disc space-y-0.5 pl-4 text-muted">
                  {considerations.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <div className="mb-1 text-faint">Matching keywords</div>
              <div className="flex flex-wrap gap-1">
                {keywords.slice(0, 16).map((k, i) => (
                  <span key={i} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10.5px] text-muted">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

