import fs from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { LegacyBadge, VerificationBadge } from "@/components/badges";
import { AnswerResolver, ClassificationPicker, DuplicateButtons, IssueButtons } from "@/components/dq-actions";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { prisma } from "@/lib/db";
import { LEGACY_FLAGGED, LEGACY_LABEL } from "@/lib/filters";
import { computeInventory } from "@/lib/inventory";
import { parseJson } from "@/lib/json";
import { cn, relTime } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

type SP = Record<string, string | string[] | undefined>;
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "duplicates", label: "Duplicates" },
  { id: "answers", label: "Answer conflicts" },
  { id: "issues", label: "Review queue" },
  { id: "classification", label: "Classification" },
  { id: "legacy", label: "Outdated content" },
  { id: "imports", label: "Import runs" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default async function DataQualityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { isAdmin: admin } = await requireUser();
  const tab = (TABS.find((t) => t.id === sp.tab)?.id ?? "overview") as Tab;
  const counts = {
    duplicates: await prisma.duplicateCandidate.count({ where: { status: "pending" } }),
    answers: await prisma.canonicalQuestion.count({ where: { active: true, verification: { in: ["conflict", "contested", "unknown"] } } }),
    issues: await prisma.importIssue.count({ where: { active: true, status: "open" } }),
    classification: await prisma.canonicalQuestion.count({ where: { active: true, OR: [{ classificationStatus: "unmapped" }, { classificationConfidence: "low" }] } }),
    legacy: await prisma.canonicalQuestion.count({ where: { active: true, legacyStatus: { in: [...LEGACY_FLAGGED] } } }),
  } as Record<string, number>;
  return (
    <div className="animate-in">
      <PageHeader title="Data Quality" description="Extraction results, deduplication decisions, answer verification and the manual review queue. Every decision is reversible and preserves everyone's progress." />
      {!admin && (
        <div className="mb-5 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-muted" data-testid="dq-readonly">
          Read-only view. The question bank is shared by everyone, so only administrators (listed in <code>ADMIN_EMAILS</code>) can change duplicate, answer, issue and classification decisions.
        </div>
      )}
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Data quality sections">
        {TABS.map((t) => (
          <Link key={t.id} href={`/data-quality?tab=${t.id}`} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] whitespace-nowrap transition-colors", tab === t.id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg-2")} data-testid={`dq-tab-${t.id}`}>
            {t.label}
            {counts[t.id] ? <span className="rounded bg-white/[0.06] px-1 text-[10.5px] text-muted tabular-nums">{counts[t.id]}</span> : null}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <Overview />}
      {tab === "duplicates" && <Duplicates filter={typeof sp.status === "string" ? sp.status : "review"} admin={admin} />}
      {tab === "answers" && <Answers admin={admin} />}
      {tab === "issues" && <Issues kind={typeof sp.kind === "string" ? sp.kind : undefined} status={typeof sp.status === "string" ? sp.status : "open"} admin={admin} />}
      {tab === "classification" && <Classification admin={admin} />}
      {tab === "legacy" && <Legacy />}
      {tab === "imports" && <Imports />}
    </div>
  );
}

type SourceReport = { [key: string]: unknown; file?: string; url?: string; missing_question_numbers?: number[]; missing_pages?: number[]; image_failures?: unknown[]; access_notes?: string };
type ImportReport = { sources?: { pdf?: SourceReport; examprepper?: SourceReport } };
type RunSummary = { final?: { uniqueQuestions: number; confirmedOverlap: number; openReviewItems: number }; rebuild?: { rebuilt: number; merged: number; created: number } };

async function readReport(): Promise<ImportReport | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "data/reports/import_report.json"), "utf8"));
  } catch {
    return null;
  }
}

async function Overview() {
  const inv = await computeInventory(prisma);
  const report = await readReport();
  const pdf = report?.sources?.pdf;
  const ep = report?.sources?.examprepper;
  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium text-fg">
          {inv.identityHolds ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-bad" />}
          Unique = PDF + Website − Overlap: {inv.pdfSourceQuestions} + {inv.websiteSourceQuestions} − {inv.confirmedOverlap} = {inv.pdfSourceQuestions + inv.websiteSourceQuestions - inv.confirmedOverlap}
          <span className="text-muted">({inv.uniqueQuestions} canonical questions in the database)</span>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8" data-testid="inventory">
          <Stat label="PDF questions" value={inv.pdfSourceQuestions} />
          <Stat label="Website questions" value={inv.websiteSourceQuestions} />
          <Stat label="Confirmed overlap" value={inv.confirmedOverlap} />
          <Stat label="Unique total" value={inv.uniqueQuestions} tone="accent" />
          <Stat label="PDF only" value={inv.pdfOnly} />
          <Stat label="Website only" value={inv.websiteOnly} />
          <Stat label="Same-source merges" value={inv.intraSourceMerged} />
          <Stat label="Open review items" value={inv.openReviewItems} tone={inv.openReviewItems ? "warn" : "ok"} />
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="PDF extraction" subtitle={pdf?.file} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 pb-5 text-xs">
            {pdf &&
              [
                ["Pages", pdf.pages],
                ["Declared / extracted", `${pdf.declared_count} / ${pdf.extracted}`],
                ["Failed", pdf.failed],
                ["Missing question numbers", pdf.missing_question_numbers?.length ? pdf.missing_question_numbers.join(", ") : "none"],
                ["Missing answer key", pdf.missing_answer],
                ["Missing options", pdf.missing_options],
                ["Embedded images", pdf.with_images],
                ["References a missing exhibit", pdf.references_missing_exhibit],
                ["Incomplete multi-select keys", pdf.multi_select_incomplete ?? "see review queue"],
                ["Explanations", pdf.explanations],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between border-b border-line/50 py-1">
                  <dt className="text-muted">{String(k)}</dt>
                  <dd className="text-fg-2 tabular-nums">{String(v)}</dd>
                </div>
              ))}
          </dl>
        </Card>
        <Card>
          <CardHeader title="ExamPrepper extraction" subtitle={ep?.url} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 pb-3 text-xs">
            {ep &&
              [
                ["Declared / extracted", `${ep.declared_count} / ${ep.extracted}`],
                ["Pages captured", `${ep.captured_pages} / ${ep.expected_pages}`],
                ["Missing pages", ep.missing_pages?.length ? ep.missing_pages.join(", ") : "none"],
                ["Failed", ep.failed],
                ["Questions with images", ep.with_images],
                ["Image download failures", ep.image_failures?.length ?? 0],
                ["Multi-select", ep.multi_select],
                ["Site key ≠ ExamTopics key", ep.site_vs_examtopics_key_differs],
                ["Explanations", ep.explanations],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between border-b border-line/50 py-1">
                  <dt className="text-muted">{String(k)}</dt>
                  <dd className="text-fg-2 tabular-nums">{String(v)}</dd>
                </div>
              ))}
          </dl>
          {ep?.access_notes && <p className="px-5 pb-5 text-[11px] text-faint">{ep.access_notes}</p>}
        </Card>
        <Card>
          <CardHeader title="Answer verification" subtitle="Only verified, single-source and user-resolved answers are graded" />
          <div className="space-y-1.5 px-5 pb-5 text-xs">
            {Object.entries(inv.byVerification)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <VerificationBadge status={k} />
                  <span className="text-fg-2 tabular-nums">{v}</span>
                </div>
              ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Currency against the June 2026 guide" />
          <div className="space-y-1.5 px-5 pb-5 text-xs">
            {Object.entries(inv.byLegacy)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <LegacyBadge status={k} />
                    {k === "current" || k === "renamed_terminology" ? <span className="text-muted">{LEGACY_LABEL[k]}</span> : null}
                  </span>
                  <span className="text-fg-2 tabular-nums">{v}</span>
                </div>
              ))}
            <p className="pt-2 text-[11px] text-faint">&quot;Renamed terms&quot; only uses an older product name (for example Vertex AI, now Gemini Enterprise Agent Platform) and is not flagged as outdated.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

type Occ = { sourceKey: string; sourceId: string; sourceQnum: number; page: number | null; url: string | null; stem: string; options: string; answerLabels: string; canonical: { code: string } | null };

function OccPanel({ o }: { o: Occ | undefined }) {
  if (!o) return <div className="text-xs text-faint">Missing occurrence</div>;
  const opts = parseJson<{ label: string; text: string }[]>(o.options, []);
  const ans = parseJson<string[]>(o.answerLabels, []);
  return (
    <div className="min-w-0 text-xs">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
        <Badge tone={o.sourceId === "pdf" ? "accent" : "violet"}>{o.sourceId === "pdf" ? `PDF Q${o.sourceQnum}` : `ExamPrepper Q${o.sourceQnum}`}</Badge>
        {o.page && <span>page {o.page}</span>}
        {o.canonical && (
          <Link href={`/questions/${o.canonical.code}`} className="hover:text-accent">
            {o.canonical.code}
          </Link>
        )}
        <span className="ml-auto">key {ans.join(", ") || "-"}</span>
      </div>
      <p className="prose-q line-clamp-6 text-fg-2">{o.stem.replace(/\[\[img:\d+\]\]/g, "[image]")}</p>
      <ul className="mt-1.5 space-y-0.5 text-muted">
        {opts.map((x) => (
          <li key={x.label} className="line-clamp-2">
            <span className="font-semibold text-fg-2">{x.label}.</span> {x.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function Duplicates({ filter, admin }: { filter: string; admin: boolean }) {
  const where =
    filter === "review"
      ? { OR: [{ status: "pending" }, { status: "auto_rejected", stemRatio: { gte: 80 } }] }
      : filter === "merged"
        ? { status: { in: ["auto_confirmed", "approved"] }, stage: { not: "exact" } }
        : filter === "decided"
          ? { status: { in: ["approved", "rejected"] } }
          : filter === "rejected"
            ? { status: { in: ["auto_rejected", "rejected"] } }
            : {};
  const cands = await prisma.duplicateCandidate.findMany({ where, orderBy: [{ status: "asc" }, { score: "desc" }], take: 120 });
  const keys = [...new Set(cands.flatMap((c) => [c.aKey, c.bKey]))];
  const occs = await prisma.sourceOccurrence.findMany({ where: { sourceKey: { in: keys } }, select: { sourceKey: true, sourceId: true, sourceQnum: true, page: true, url: true, stem: true, options: true, answerLabels: true, canonical: { select: { code: true } } } });
  const byKey = new Map(occs.map((o) => [o.sourceKey, o]));
  const filters = [
    { id: "review", label: "Needs a look (pending + near-miss rejections)" },
    { id: "merged", label: "Fuzzy / semantic merges" },
    { id: "rejected", label: "Rejected" },
    { id: "decided", label: "Your decisions" },
    { id: "all", label: "All" },
  ];
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link key={f.id} href={`/data-quality?tab=duplicates&status=${f.id}`} className={cn("rounded-lg border px-2.5 py-1 text-xs", filter === f.id ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg-2")}>
            {f.label}
          </Link>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">
        Exact matches merge automatically. Fuzzy matches merge when stems are at least 90% similar, options at least 85% similar, no numbers differ and answers agree. Pairs from the same source with differing details are kept separate as variants. Approving or rejecting a pair rebuilds canonical questions immediately; attempts, flags and notes follow the question.
      </p>
      {cands.length === 0 && <EmptyState title="Nothing here" description="No duplicate candidates match this filter." />}
      <div className="flex flex-col gap-3">
        {cands.map((c) => (
          <Card key={c.pairKey} className="p-4" data-testid="dup-card">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="outline">{c.stage}</Badge>
              <Badge tone={c.status === "approved" || c.status === "auto_confirmed" ? "ok" : c.status === "pending" ? "warn" : "neutral"}>{c.status.replace("_", " ")}</Badge>
              <span className="text-muted">
                stem {c.stemRatio.toFixed(0)} · options {c.optionSim.toFixed(0)}
                {c.cosine !== null ? ` · cosine ${c.cosine.toFixed(2)}` : ""} · answers {c.answersAgree ? "agree" : "differ"}
              </span>
              {parseJson<string[]>(c.numberMismatch, []).length > 0 && <Badge tone="warn">numbers differ: {parseJson<string[]>(c.numberMismatch, []).join(", ")}</Badge>}
              <span className="ml-auto text-faint">{c.reason}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <OccPanel o={byKey.get(c.aKey)} />
              <OccPanel o={byKey.get(c.bKey)} />
            </div>
            <div className="mt-3 border-t border-line pt-3">
              {admin && <DuplicateButtons pairKey={c.pairKey} status={c.status} previousStatus={c.previousStatus} />}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

async function Answers({ admin }: { admin: boolean }) {
  const qs = await prisma.canonicalQuestion.findMany({
    where: { active: true, OR: [{ verification: { in: ["conflict", "contested", "unknown"] } }, { claims: { some: { kind: "user_override" } } }] },
    include: { claims: true, options: { orderBy: { order: "asc" } } },
    orderBy: [{ verification: "asc" }, { code: "asc" }],
  });
  return (
    <div>
      <p className="mb-4 text-xs text-muted">
        These questions have disagreeing answer keys, disputed community votes or no key. They are not graded until you resolve them. Setting an answer creates a user-verified claim and regrades your earlier ungraded attempts. Check the official documentation before deciding.
      </p>
      {qs.length === 0 && <EmptyState title="No answer conflicts" />}
      <div className="flex flex-col gap-3">
        {qs.map((q) => {
          const override = q.claims.find((c) => c.kind === "user_override");
          return (
            <Card key={q.id} className="p-4" data-testid="conflict-card">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <Link href={`/questions/${q.code}`} className="font-mono font-semibold text-fg hover:text-accent">
                  {q.code}
                </Link>
                <VerificationBadge status={q.verification} />
                <span className="text-muted">{q.verificationNote}</span>
              </div>
              <p className="prose-q line-clamp-3 text-xs text-fg-2">{q.stem.replace(/\[\[img:\d+\]\]/g, "[image]")}</p>
              <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-muted md:grid-cols-2">
                {q.options.map((o) => (
                  <li key={o.label} className="line-clamp-2">
                    <span className="font-semibold text-fg-2">{o.label}.</span> {o.text}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                {q.claims
                  .filter((c) => c.kind !== "user_override")
                  .map((c) => (
                    <span key={c.id} className="text-muted">
                      {c.kind.replace("_", " ")}: <span className="font-semibold text-fg-2">{parseJson<string[]>(c.labels, []).join(", ")}</span>
                      {c.percent !== null ? ` (${c.percent}%)` : ""}
                      {c.incomplete ? " · incomplete" : ""}
                    </span>
                  ))}
              </div>
              <div className="mt-3 border-t border-line pt-3">
                {admin && <AnswerResolver questionId={q.id} labels={q.options.map((o) => o.label)} current={override ? parseJson<string[]>(override.labels, []) : null} hasOverride={!!override} />}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

async function Issues({ kind, status, admin }: { kind?: string; status: string; admin: boolean }) {
  const kinds = await prisma.importIssue.groupBy({ by: ["kind"], where: { active: true, status: "open" }, _count: true });
  const issues = await prisma.importIssue.findMany({
    where: { active: true, ...(kind ? { kind } : {}), ...(status === "all" ? {} : { status }) },
    include: { question: { select: { code: true } } },
    orderBy: [{ severity: "desc" }, { kind: "asc" }, { issueKey: "asc" }],
    take: 300,
  });
  const link = (p: Record<string, string | undefined>) => `/data-quality?${new URLSearchParams(Object.entries({ tab: "issues", kind, status, ...p }).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href={link({ kind: undefined })} className={cn("rounded-lg border px-2.5 py-1 text-xs", !kind ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted")}>
          All kinds
        </Link>
        {kinds.map((k) => (
          <Link key={k.kind} href={link({ kind: k.kind })} className={cn("rounded-lg border px-2.5 py-1 text-xs", kind === k.kind ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg-2")}>
            {k.kind.replaceAll("_", " ")} <span className="text-faint">{k._count}</span>
          </Link>
        ))}
        <span className="mx-1 w-px bg-line" />
        {["open", "resolved", "ignored", "all"].map((s) => (
          <Link key={s} href={link({ status: s })} className={cn("rounded-lg border px-2.5 py-1 text-xs capitalize", status === s ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg-2")}>
            {s}
          </Link>
        ))}
      </div>
      {issues.length === 0 ? (
        <EmptyState title="Queue is empty" description="No issues match these filters." />
      ) : (
        <Card>
          <div className="divide-y divide-line">
            {issues.map((i) => (
              <div key={i.issueKey} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-xs" data-testid="issue-row">
                <Badge tone={i.severity === "error" ? "bad" : i.severity === "warning" ? "warn" : "neutral"}>{i.severity}</Badge>
                <span className="w-44 shrink-0 text-muted">{i.kind.replaceAll("_", " ")}</span>
                {i.question && (
                  <Link href={`/questions/${i.question.code}`} className="font-mono text-fg-2 hover:text-accent">
                    {i.question.code}
                  </Link>
                )}
                <span className="min-w-0 flex-1 text-fg-2">{i.message}</span>
                {i.resolution && <span className="text-faint">{i.resolution}</span>}
                {admin && <IssueButtons issueKey={i.issueKey} status={i.status} />}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

async function Classification({ admin }: { admin: boolean }) {
  const [qs, objectives] = await Promise.all([
    prisma.canonicalQuestion.findMany({ where: { active: true, OR: [{ classificationStatus: "unmapped" }, { classificationConfidence: "low" }, { classificationStatus: "manual" }] }, orderBy: [{ classificationStatus: "desc" }, { classificationConfidenceValue: "asc" }] }),
    prisma.examObjective.findMany({ orderBy: { order: "asc" }, select: { code: true, title: true } }),
  ]);
  return (
    <div>
      <p className="mb-4 text-xs text-muted">Questions the keyword classifier could not map, or mapped with low confidence. Assign the objective you believe is correct; manual choices survive reimports.</p>
      <Card>
        <div className="divide-y divide-line">
          {qs.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-xs">
              <Link href={`/questions/${q.code}`} className="font-mono text-fg-2 hover:text-accent">
                {q.code}
              </Link>
              <Badge tone={q.classificationStatus === "unmapped" ? "warn" : q.classificationStatus === "manual" ? "ok" : "neutral"}>{q.classificationStatus === "mapped" ? `low · ${q.objectiveCode}` : q.classificationStatus}</Badge>
              <span className="min-w-0 flex-1 truncate text-muted" title={q.classificationExplanation}>
                {q.stem.replace(/\[\[img:\d+\]\]/g, "")}
              </span>
              {admin ? <ClassificationPicker questionId={q.id} current={q.objectiveCode} objectives={objectives} /> : <span className="font-mono text-[12px] text-muted">{q.objectiveCode ?? "unmapped"}</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

async function Legacy() {
  const qs = await prisma.canonicalQuestion.findMany({ where: { active: true, legacyStatus: { in: [...LEGACY_FLAGGED] } }, orderBy: [{ legacyStatus: "asc" }, { code: "asc" }] });
  return (
    <div>
      <p className="mb-4 text-xs text-muted">Questions that mention retired products, deprecated features or patterns the June 2026 guide no longer emphasizes. The concepts may still apply, but answer choices can reflect old product behaviour. These are excluded from mock exams by default.</p>
      <Card>
        <div className="divide-y divide-line">
          {qs.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-xs">
              <Link href={`/questions/${q.code}`} className="font-mono text-fg-2 hover:text-accent">
                {q.code}
              </Link>
              <LegacyBadge status={q.legacyStatus} />
              <span className="min-w-0 flex-1 text-muted">
                {parseJson<{ term: string; modern: string }[]>(q.legacyNotes, [])
                  .map((l) => `${l.term}: ${l.modern}`)
                  .join(" · ")}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

async function Imports() {
  const runs = await prisma.importRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 });
  return (
    <div>
      <p className="mb-4 text-xs text-muted">
        Reimport with <code className="rounded bg-white/[0.06] px-1">npm run ingest</code>. Imports are idempotent: source occurrences are upserted by source key, canonical IDs stay stable, your duplicate and answer decisions are kept, and attempts, flags, notes and theory progress are never deleted.
      </p>
      <Card>
        <div className="divide-y divide-line">
          {runs.map((r) => {
            const s = parseJson<RunSummary>(r.summary, {});
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-xs">
                <span className="font-mono text-fg-2">#{r.id}</span>
                <Badge tone={r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : "warn"}>{r.status}</Badge>
                <span className="text-muted">{r.startedAt.toLocaleString()}</span>
                <span className="text-faint">{relTime(r.startedAt)}</span>
                <span className="ml-auto text-muted">
                  {s.final ? `${s.final.uniqueQuestions} unique · ${s.final.confirmedOverlap} overlap · ${s.final.openReviewItems} open items` : ""}
                  {s.rebuild ? ` · rebuilt ${s.rebuild.rebuilt}, merged ${s.rebuild.merged}, split ${s.rebuild.created}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
