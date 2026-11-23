import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { LegacyBadge, VerificationBadge } from "@/components/badges";
import { AnswerResolver, ClassificationPicker, DuplicateButtons, IssueButtons } from "@/components/dq-actions";
import { ExcludeToggle, QuestionEditor } from "@/components/question-editor";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { certAdminPage } from "@/lib/cert";
import { inCert, isEditableStatus, neutralSourceLabels, VERSION_STATUS_LABEL, type VersionStatus } from "@/lib/cert-rules";
import { prisma } from "@/lib/db";
import { LEGACY_FLAGGED, type SourceInfo } from "@/lib/filters";
import { parseJson } from "@/lib/json";
import { BlueprintShare } from "@/components/blueprint-share";
import { DistributionCard } from "@/components/distribution-card";
import { blueprintDistribution, type Distribution, parseVerifiedWeights, PROPORTIONAL_PP, verificationState } from "@/lib/blueprint";
import { computeInventory } from "@/lib/inventory";
import { type DraftQuality, isValidOccurrence, loadDraftQuality } from "@/lib/quality";
import { manualEditOf } from "@/lib/question-edit";
import { ISSUE_TEXT, LOW_CONFIDENCE_METHODS } from "@/lib/review-queue";
import { cn, domainColor, pct, relTime } from "@/lib/utils";

type SP = Record<string, string | string[] | undefined>;
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "questions", label: "Questions" },
  { id: "duplicates", label: "Duplicates" },
  { id: "answers", label: "Answer conflicts" },
  { id: "issues", label: "Review queue" },
  { id: "classification", label: "Classification" },
  { id: "legacy", label: "Outdated content" },
  { id: "imports", label: "Import runs" },
] as const;
type Tab = (typeof TABS)[number]["id"];

type Ctx = { vid: string; canEdit: boolean; tabHref: (query: string) => string; qHref: (code: string) => string | null; dataHref: string; sources: SourceInfo[] };

function QCode({ ctx, code, className }: { ctx: Ctx; code: string; className?: string }) {
  const href = ctx.qHref(code);
  return href ? (
    <Link href={href} className={className}>
      {code}
    </Link>
  ) : (
    <span className={className}>{code}</span>
  );
}

/** Exam Coverage & Quality (administrators only): the published version read-only, or a draft (?version=). */
export default async function DataQualityPage({ params, searchParams }: { params: Promise<{ cert: string }>; searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { user, cert, base, version: published } = await certAdminPage(params);
  if (!user.isAdmin) notFound();
  const L = (h: string) => inCert(base, h);
  const requested = typeof sp.version === "string" ? sp.version : null;
  const fields = { id: true, label: true, status: true, publishedAt: true, publishedBy: true, guideTitle: true, questionCount: true, objectiveCount: true } as const;
  let v = published;
  if (requested && requested !== published?.id) {
    v = await prisma.contentVersion.findFirst({ where: { id: requested, certificationId: cert.id }, select: fields });
  } else if (!v) {
    v = await prisma.contentVersion.findFirst({ where: { certificationId: cert.id, status: { in: ["draft", "review"] } }, orderBy: { createdAt: "desc" }, select: fields });
  }
  if (!v) notFound();
  const editable = isEditableStatus(v.status);
  const vq = v.id === published?.id ? "" : `&version=${encodeURIComponent(v.id)}`;
  const sources = await prisma.questionSource.findMany({ where: { versionId: v.id }, select: { id: true, name: true, kind: true }, orderBy: [{ kind: "asc" }, { id: "asc" }] });
  const ctx: Ctx = { vid: v.id, canEdit: user.canManageContent && editable, tabHref: (q) => L(`/data-quality?${q}${vq}`), qHref: (code) => (vq ? null : L(`/questions/${code}`)), dataHref: L("/data"), sources };
  const tab = (TABS.find((t) => t.id === sp.tab)?.id ?? "overview") as Tab;
  const vw = { versionId: v.id };
  const counts = {
    questions: await prisma.importIssue.count({ where: { ...vw, active: true, status: "open", severity: "error", questionId: { not: null } } }),
    duplicates: await prisma.duplicateCandidate.count({ where: { ...vw, status: "pending" } }),
    answers: await prisma.canonicalQuestion.count({ where: { ...vw, active: true, verification: { in: ["conflict", "contested", "unknown"] } } }),
    issues: await prisma.importIssue.count({ where: { ...vw, active: true, status: "open" } }),
    classification: await prisma.canonicalQuestion.count({ where: { ...vw, active: true, OR: [{ classificationStatus: "unmapped" }, { classificationConfidence: "low" }] } }),
    legacy: await prisma.canonicalQuestion.count({ where: { ...vw, active: true, legacyStatus: { in: [...LEGACY_FLAGGED] } } }),
  } as Record<string, number>;
  return (
    <div className="animate-in">
      <PageHeader
        title="Exam Coverage & Quality"
        description={`${cert.code} ${v.label} (${VERSION_STATUS_LABEL[v.status as VersionStatus] ?? v.status}). How the bank covers the official exam guide, extraction results, deduplication decisions, answer verification and the manual review queue.`}
      />
      {!editable ? (
        <div className="mb-5 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-[12.5px] text-muted" data-testid="dq-readonly">
          Read-only view of a {v.status} version. Published content never changes, so learners&apos; progress always refers to exactly what they studied. To correct something, create a draft in{" "}
          <Link href={L("/data")} className="text-accent hover:underline">
            Data Settings
          </Link>
          , review it there and publish it.
        </div>
      ) : !ctx.canEdit ? (
        <div className="mb-5 rounded-lg border border-warn/30 bg-warn-soft px-4 py-2.5 text-[12.5px] text-warn" data-testid="dq-elevate">
          Confirm your administrator access code in Settings to change this draft.
        </div>
      ) : (
        <div className="mb-5 rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12.5px] text-fg-2" data-testid="dq-draft">
          Reviewing draft {v.label}. Decisions here change the draft only; learners see them after it is published from{" "}
          <Link href={L("/data")} className="text-accent hover:underline">
            Data Settings
          </Link>
          .
        </div>
      )}
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Exam coverage and quality sections">
        {TABS.map((t) => (
          <Link key={t.id} href={ctx.tabHref(`tab=${t.id}`)} className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] whitespace-nowrap transition-colors", tab === t.id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg-2")} data-testid={`dq-tab-${t.id}`}>
            {t.label}
            {counts[t.id] ? <span className="rounded bg-white/[0.06] px-1 text-[10.5px] text-muted tabular-nums">{counts[t.id]}</span> : null}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <Overview ctx={ctx} />}
      {tab === "questions" && <Questions ctx={ctx} filter={typeof sp.show === "string" ? sp.show : "all"} page={Math.max(1, Number(sp.page) || 1)} search={typeof sp.q === "string" ? sp.q.slice(0, 100) : ""} />}
      {tab === "duplicates" && <Duplicates filter={typeof sp.status === "string" ? sp.status : "review"} ctx={ctx} />}
      {tab === "answers" && <Answers ctx={ctx} />}
      {tab === "issues" && <Issues kind={typeof sp.kind === "string" ? sp.kind.slice(0, 60) : undefined} status={typeof sp.status === "string" ? sp.status : "open"} ctx={ctx} />}
      {tab === "classification" && <Classification ctx={ctx} />}
      {tab === "legacy" && <Legacy ctx={ctx} />}
      {tab === "imports" && <Imports ctx={ctx} />}
    </div>
  );
}

type RunSummary = { final?: { uniqueQuestions: number; confirmedOverlap: number; openReviewItems: number }; rebuild?: { rebuilt: number; merged: number; created: number }; sources?: Record<string, Record<string, unknown>> };

const fmtValue = (v: unknown) => (Array.isArray(v) ? (v.length ? v.slice(0, 20).join(", ") : "none") : typeof v === "object" && v !== null ? JSON.stringify(v).slice(0, 80) : String(v));

async function Overview({ ctx }: { ctx: Ctx }) {
  const [quality, domains, objectives, objectiveCounts, version] = await Promise.all([
    loadDraftQuality(prisma, ctx.vid),
    prisma.examDomain.findMany({ where: { versionId: ctx.vid }, orderBy: { number: "asc" }, select: { number: true, title: true, weightPercent: true } }),
    prisma.examObjective.findMany({ where: { versionId: ctx.vid }, orderBy: [{ domainNumber: "asc" }, { order: "asc" }], select: { code: true } }),
    prisma.canonicalQuestion.groupBy({ by: ["objectiveCode"], where: { versionId: ctx.vid, active: true }, _count: true }),
    prisma.contentVersion.findUnique({ where: { id: ctx.vid }, select: { guideTitle: true, label: true } }),
  ]);
  const inv = quality.inventory;
  const dist = blueprintDistribution(domains, inv.byDomain);
  const state = verificationState(ctx.vid, domains, parseVerifiedWeights(process.env.BLUEPRINT_VERIFIED_WEIGHTS));
  const covered = new Set(objectiveCounts.filter((o) => o._count > 0).map((o) => o.objectiveCode));
  const empty = objectives.filter((o) => !covered.has(o.code)).map((o) => o.code);
  const guide = version?.guideTitle ?? `version ${version?.label ?? ""}`;
  return (
    <div className="flex flex-col gap-5" data-testid="coverage-overview">
      <DistributionCard dist={dist} state={state} />
      {dist.rows.length > 0 && (
        <BlueprintShare
          dist={dist}
          linkDomains={false}
          note={
            <span data-testid="scaling-note">
              Official weights from {guide}, shown as published. The published values total {dist.weightSum}%; for the comparison and the score each is scaled proportionally (weight ÷ {dist.weightSum}).
            </span>
          }
        />
      )}
      <DomainTable dist={dist} empty={empty} ctx={ctx} />
      <QuestionQuality q={quality} ctx={ctx} />
      <SourcesTable q={quality} ctx={ctx} />
    </div>
  );
}

const fmtPp = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} pp`;

const DIST_STATUS: Record<string, [string, "ok" | "accent" | "warn"]> = { proportional: ["Proportional", "ok"], over: ["Over", "accent"], under: ["Under", "warn"] };

function DomainTable({ dist, empty, ctx }: { dist: Distribution; empty: string[]; ctx: Ctx }) {
  if (!dist.rows.length) return null;
  return (
    <Card data-testid="domain-coverage">
      <CardHeader title="Domain coverage" subtitle={`Difference is the bank share minus the scaled official weight; within ±${PROPORTIONAL_PP} pp counts as proportional.`} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[11px] text-faint">
            <tr>
              <th className="px-5 py-2 font-medium">Domain</th>
              <th className="px-2 py-2 text-right font-medium">Official weight</th>
              <th className="px-2 py-2 text-right font-medium">Bank share</th>
              <th className="px-2 py-2 text-right font-medium">Questions</th>
              <th className="px-2 py-2 text-right font-medium">Difference</th>
              <th className="px-5 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {dist.rows.map((r) => {
              const [label, tone] = r.status ? DIST_STATUS[r.status] : ["n/a", "warn" as const];
              return (
                <tr key={r.number} data-testid={`domain-row-${r.number}`}>
                  <td className="px-5 py-2">
                    <span className="flex items-center gap-2 text-fg-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: domainColor(r.number) }} />
                      {r.number}. {r.title}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums" data-testid="published-weight">
                    {r.publishedWeight === null ? "n/a" : `${r.publishedWeight}%`}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{pct(r.share, 1)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.count}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.diffPp === null ? "n/a" : fmtPp(r.diffPp)}</td>
                  <td className="px-5 py-2">
                    <Badge tone={tone}>{label}</Badge>
                  </td>
                </tr>
              );
            })}
            {dist.unmapped > 0 && (
              <tr className="text-muted">
                <td className="px-5 py-2">Unmapped</td>
                <td className="px-2 py-2 text-right">-</td>
                <td className="px-2 py-2 text-right tabular-nums">{pct(dist.unmappedShare, 1)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{dist.unmapped}</td>
                <td className="px-2 py-2 text-right" />
                <td className="px-5 py-2" />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {empty.length > 0 && (
        <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
          Objectives with no questions:{" "}
          <Link href={ctx.tabHref("tab=classification")} className="text-accent hover:underline">
            {empty.join(", ")}
          </Link>
        </p>
      )}
    </Card>
  );
}

function QuestionQuality({ q, ctx }: { q: DraftQuality; ctx: Ctx }) {
  const inv = q.inventory;
  const legacy = ["renamed_service", "deprecated_feature", "possibly_outdated", "verified_obsolete"] as const;
  return (
    <Card data-testid="question-quality">
      <CardHeader title="Question quality" subtitle="Content checks of the unique questions. Independent of the distribution above." />
      <div className="grid grid-cols-2 gap-4 px-5 pb-4 md:grid-cols-5">
        <Stat label="Total questions" value={inv.uniqueQuestions} tone="accent" />
        <Stat label="Found in 2+ sources" value={inv.confirmedOverlap} hint={`merged duplicates: ${q.duplicates.merged} · decisions pending: ${q.duplicates.pending}`} />
        <Stat label="Answer conflicts" value={q.questions.conflicts} tone={q.questions.conflicts ? "warn" : "ok"} />
        <Stat label="Open review items" value={inv.openReviewItems} tone={inv.openReviewItems ? "warn" : "ok"} />
        <Stat label="Exhibits without a local copy" value={q.exhibits.missing} tone={q.exhibits.missing ? "warn" : "ok"} hint={`of ${q.exhibits.total} exhibits`} />
      </div>
      <QualitySummary q={q} ctx={ctx} />
      <div className="grid gap-5 border-t border-line px-5 py-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-medium text-fg-2">Answer verification</div>
          <div className="space-y-1.5 text-xs">
            {Object.entries(inv.byVerification)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <VerificationBadge status={k} />
                  <span className="text-fg-2 tabular-nums">{v}</span>
                </div>
              ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-fg-2">Currency against the exam guide</div>
          <div className="space-y-1.5 text-xs">
            {legacy.map((k) => (
              <div key={k} className="flex items-center justify-between">
                <Link href={ctx.tabHref("tab=legacy")} className="hover:text-accent">
                  <LegacyBadge status={k} />
                </Link>
                <span className="text-fg-2 tabular-nums">{inv.byLegacy[k] ?? 0}</span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-faint">
              {inv.byLegacy.current ?? 0} current, {inv.byLegacy.renamed_terminology ?? 0} with renamed terms only (not flagged as outdated).
            </p>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Per-source summary under neutral labels; real names stay in Data Settings and the investigation tabs. */
function SourcesTable({ q, ctx }: { q: DraftQuality; ctx: Ctx }) {
  if (!q.sources.length) return null;
  const labels = neutralSourceLabels(q.sources.map((s) => s.key));
  const multi = q.sources.length > 1;
  const num = "px-2 py-2 text-right tabular-nums";
  return (
    <Card data-testid="dq-sources">
      <CardHeader
        title="Sources"
        action={
          <Link href={ctx.dataHref} className="text-xs text-accent hover:underline">
            Source details → Data Settings
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[11px] text-faint">
            <tr>
              <th className="px-5 py-2 font-medium">Source</th>
              <th className="px-2 py-2 text-right font-medium">Extracted</th>
              <th className="px-2 py-2 text-right font-medium">In bank</th>
              {multi && <th className="px-2 py-2 text-right font-medium">Shared</th>}
              <th className="px-2 py-2 text-right font-medium">Verified</th>
              <th className="px-2 py-2 text-right font-medium">Answer conflicts</th>
              <th className="px-2 py-2 text-right font-medium">Legacy name</th>
              <th className="px-2 py-2 text-right font-medium">Deprecated</th>
              <th className="px-2 py-2 text-right font-medium">Needs verification</th>
              <th className="px-2 py-2 text-right font-medium">Open issues</th>
              <th className="px-5 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {q.sources.map((s) => {
              const [label, tone] = SOURCE_STATE[s.state] ?? [s.state, "neutral"];
              return (
                <tr key={s.key} data-testid="source-summary-row">
                  <td className="px-5 py-2 text-fg-2">{labels.get(s.key)!.label}</td>
                  <td className={num}>{s.extracted}</td>
                  <td className={num}>{s.questions}</td>
                  {multi && <td className={num}>{s.shared}</td>}
                  <td className={num}>{s.verified}</td>
                  <td className={cn(num, s.conflicts && "text-warn")}>{s.conflicts}</td>
                  <td className={num}>{s.legacyName}</td>
                  <td className={num}>{s.deprecated}</td>
                  <td className={num}>{s.needsVerification}</td>
                  <td className={num}>
                    <span className={s.openErrors ? "text-bad" : ""}>{s.openErrors}</span> / <span className={s.openWarnings ? "text-warn" : ""}>{s.openWarnings}</span>
                  </td>
                  <td className="px-5 py-2">
                    <Badge tone={tone}>{label}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-5 py-2.5 text-[11px] text-faint">
        A question found in several sources is counted under each of them; totals above count it once. Open issues are errors / warnings.
      </p>
    </Card>
  );
}

const SOURCE_STATE: Record<string, [string, "ok" | "warn" | "bad" | "neutral" | "accent" | "outline"]> = {
  waiting: ["waiting to start", "neutral"],
  queued: ["queued", "accent"],
  retry_scheduled: ["retry scheduled", "warn"],
  processing: ["processing", "accent"],
  processed: ["processed", "ok"],
  failed: ["failed", "bad"],
  copied: ["copied", "outline"],
};

/** Validity of the extracted questions: the second row of the question-quality card. */
function QualitySummary({ q, ctx }: { q: DraftQuality; ctx: Ctx }) {
  return (
    <div className="border-t border-line" data-testid="dq-summary">
      <div className="grid grid-cols-2 gap-4 px-5 py-4 md:grid-cols-5" data-testid="dq-metrics" title="A question is valid when it has a stem of at least 10 characters, at least two options and an answer key that matches its options.">
        <Stat label="Extracted" value={q.extracted.total} />
        <Stat label="Valid" value={q.extracted.valid} tone={q.extracted.valid ? "ok" : undefined} />
        <Stat label="Invalid" value={q.extracted.invalid} tone={q.extracted.invalid ? "bad" : undefined} hint={q.extracted.excluded ? `${q.extracted.excluded} excluded` : undefined} />
        <Stat label="Mapped to objective" value={q.questions.mapped} />
        <Stat label="Unmapped" value={q.questions.unmapped} tone={q.questions.unmapped ? "warn" : undefined} />
        <Stat label="Gradable" value={q.questions.gradable} hint={`${q.questions.ungradable} without verified answer`} />
        <Stat label="Edited by reviewers" value={q.extracted.edited} hint={q.extracted.lowConfidence ? `${q.extracted.lowConfidence} read by OCR` : undefined} />
        <Stat label="Duplicates merged" value={q.duplicates.merged} hint={`${q.duplicates.rejected} kept separate`} />
        <Stat label="Duplicates to decide" value={q.duplicates.pending} tone={q.duplicates.pending ? "warn" : undefined} />
        <Stat label="Needs review" value={q.issues.error + q.issues.warning} tone={q.issues.error ? "bad" : q.issues.warning ? "warn" : "ok"} hint={`${q.issues.error} blocking`} />
      </div>
      {q.issues.kinds.length > 0 && (
        <div className="border-t border-line px-5 py-3" data-testid="dq-issue-kinds">
          <div className="mb-1.5 text-xs font-medium text-fg-2">Validation errors and warnings</div>
          <ul className="space-y-1 text-xs">
            {q.issues.kinds.map((k) => (
              <li key={k.kind} className="flex flex-wrap items-center gap-2">
                <Badge tone={k.severity === "error" ? "bad" : k.severity === "warning" ? "warn" : "neutral"}>{k.severity}</Badge>
                <Link href={ctx.tabHref(`tab=issues&kind=${encodeURIComponent(k.kind)}`)} className="text-fg-2 hover:text-accent">
                  {k.kind.replaceAll("_", " ")}
                </Link>
                <span className="tabular-nums text-muted">{k.count}</span>
                {ISSUE_TEXT[k.kind] && <span className="text-faint">{ISSUE_TEXT[k.kind][1]}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const Q_FILTERS = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs attention" },
  { id: "multi", label: "In 2+ sources" },
  { id: "edited", label: "Edited" },
  { id: "ocr", label: "Read by OCR" },
  { id: "excluded", label: "Excluded" },
];
const PER_PAGE = 20;

async function Questions({ ctx, filter, page, search }: { ctx: Ctx; filter: string; page: number; search: string }) {
  const vid = ctx.vid;
  const [occs, edited, errorIssues, active] = await Promise.all([
    prisma.sourceOccurrence.findMany({ where: { versionId: vid }, select: { sourceKey: true, sourceId: true, sourceQnum: true, canonicalId: true, stem: true, options: true, issues: true, excluded: true, extractionMethod: true, page: true, url: true } }),
    prisma.sourceOccurrence.findMany({ where: { versionId: vid, rawJson: { contains: '"manualEdit"' } }, select: { sourceKey: true } }),
    prisma.importIssue.findMany({ where: { versionId: vid, active: true, status: "open", severity: "error", questionId: { not: null } }, select: { questionId: true } }),
    prisma.canonicalQuestion.findMany({ where: { versionId: vid, active: true }, select: { id: true, code: true }, orderBy: { code: "asc" } }),
  ]);
  const editedKeys = new Set(edited.map((e) => e.sourceKey));
  const errorIds = new Set(errorIssues.map((i) => i.questionId!));
  const members = new Map<number, typeof occs>();
  for (const o of occs) if (o.canonicalId && !o.excluded) (members.get(o.canonicalId) ?? members.set(o.canonicalId, []).get(o.canonicalId)!).push(o);
  const needle = search.trim().toLowerCase();
  const keep = (id: number, code: string) => {
    const ms = members.get(id) ?? [];
    if (needle && !code.toLowerCase().includes(needle) && !ms.some((m) => m.stem.toLowerCase().includes(needle))) return false;
    if (filter === "attention") return errorIds.has(id) || ms.some((m) => !isValidOccurrence(m));
    if (filter === "multi") return new Set(ms.map((m) => m.sourceId)).size > 1;
    if (filter === "edited") return ms.some((m) => editedKeys.has(m.sourceKey));
    if (filter === "ocr") return ms.some((m) => LOW_CONFIDENCE_METHODS.has(m.extractionMethod));
    return true;
  };
  const sourceName = (id: string) => ctx.sources.find((s) => s.id === id)?.name ?? id;
  const link = (p: Record<string, string | number | undefined>) => ctx.tabHref(new URLSearchParams(Object.entries({ tab: "questions", show: filter, q: search || undefined, ...p }).filter(([, v]) => v !== undefined && v !== "") as [string, string][]).toString());

  const filterBar = (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      {Q_FILTERS.map((f) => (
        <Link key={f.id} href={link({ show: f.id, page: undefined })} className={cn("rounded-lg border px-2.5 py-1 text-xs", filter === f.id ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg-2")} data-testid={`q-filter-${f.id}`}>
          {f.label}
        </Link>
      ))}
      <form className="ml-auto flex items-center gap-1.5" action="" method="get">
        <input type="hidden" name="tab" value="questions" />
        <input type="hidden" name="show" value={filter} />
        {ctx.tabHref("").includes("version=") && <input type="hidden" name="version" value={ctx.vid} />}
        <input name="q" defaultValue={search} placeholder="Search text or code" className="h-7 w-48 rounded-lg border border-line bg-surface-2 px-2.5 text-xs text-fg outline-none focus-visible:border-accent" data-testid="q-search" />
      </form>
    </div>
  );

  if (filter === "excluded") {
    const excluded = occs.filter((o) => o.excluded && (!needle || o.stem.toLowerCase().includes(needle)));
    return (
      <div>
        {filterBar}
        <p className="mb-4 text-xs text-muted">Excluded source questions form no question and are not published. Restore one to bring it back.</p>
        {excluded.length === 0 ? (
          <EmptyState title="Nothing excluded" />
        ) : (
          <Card>
            <div className="divide-y divide-line">
              {excluded.map((o) => (
                <div key={o.sourceKey} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-xs">
                  <Badge tone="outline">{`${sourceName(o.sourceId)} Q${o.sourceQnum}`}</Badge>
                  <span className="min-w-0 flex-1 truncate text-muted">{o.stem}</span>
                  {ctx.canEdit && <ExcludeToggle versionId={vid} sourceKey={o.sourceKey} excluded />}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  const matching = active.filter((c) => keep(c.id, c.code));
  const pages = Math.max(1, Math.ceil(matching.length / PER_PAGE));
  const current = Math.min(page, pages);
  const ids = matching.slice((current - 1) * PER_PAGE, current * PER_PAGE).map((c) => c.id);
  const qs = await prisma.canonicalQuestion.findMany({
    where: { id: { in: ids } },
    include: { options: { orderBy: { order: "asc" } }, occurrences: { where: { excluded: false }, orderBy: { id: "asc" } }, issues: { where: { active: true, status: "open" } }, explanations: { where: { kind: "source" }, take: 1 } },
    orderBy: { code: "asc" },
  });
  return (
    <div>
      {filterBar}
      <p className="mb-4 text-xs text-muted" data-testid="q-count">
        {matching.length} of {active.length} questions{filter !== "all" || needle ? " match" : ""}. Each question shows every source it was found in (provenance).{ctx.canEdit ? " Edits apply to this draft only." : ""}
      </p>
      {qs.length === 0 && <EmptyState title="No questions match" description={active.length ? "Try another filter." : "Process a source to extract questions."} />}
      <div className="flex flex-col gap-3">
        {qs.map((q) => {
          const correct = parseJson<string[] | null>(q.correctLabels, null);
          const shown = correct ?? parseJson<string[]>(q.provisionalLabels, []);
          const sourcesIn = new Set(q.occurrences.map((o) => o.sourceId)).size;
          const anyEdited = q.occurrences.some((o) => manualEditOf(o));
          const invalid = q.occurrences.some((o) => !isValidOccurrence(o));
          return (
            <Card key={q.id} className="p-4" data-testid="q-card" data-code={q.code}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <QCode ctx={ctx} code={q.code} className="font-mono font-semibold text-fg hover:text-accent" />
                <VerificationBadge status={q.verification} />
                <Badge tone="outline">{q.objectiveCode ?? "unmapped"}</Badge>
                {sourcesIn > 1 && <Badge tone="violet">in {sourcesIn} sources</Badge>}
                {anyEdited && <Badge tone="accent">edited</Badge>}
                {invalid && <Badge tone="bad">invalid</Badge>}
                {q.issues.filter((i) => i.severity === "error").length > 0 && <Badge tone="bad">{q.issues.filter((i) => i.severity === "error").length} blocking</Badge>}
                <span className="ml-auto">{ctx.canEdit && <QuestionEditor questionId={q.id} code={q.code} stem={q.stem} options={q.options.map((o) => ({ label: o.label, text: o.text }))} answer={shown} explanation={q.explanations[0]?.content ?? null} />}</span>
              </div>
              <p className="prose-q whitespace-pre-line text-[13px] text-fg-2">{q.stem.replace(/\[\[img:\d+\]\]/g, "[image]")}</p>
              <ul className="mt-2 space-y-0.5 text-xs">
                {q.options.map((o) => (
                  <li key={o.label} className={cn(shown.includes(o.label) ? (correct ? "text-ok" : "text-warn") : "text-muted")}>
                    <span className="font-semibold">{o.label}.</span> {o.text}
                    {shown.includes(o.label) && <span className="ml-1 text-[10.5px]">{correct ? "(answer)" : "(provisional)"}</span>}
                  </li>
                ))}
                {q.options.length === 0 && <li className="text-bad">No options extracted.</li>}
              </ul>
              {q.explanations[0] && <p className="mt-2 line-clamp-3 text-[11.5px] text-faint">Explanation: {q.explanations[0].content}</p>}
              {q.issues.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-[11.5px]">
                  {q.issues.map((i) => (
                    <li key={i.issueKey} className={i.severity === "error" ? "text-bad" : i.severity === "warning" ? "text-warn" : "text-muted"}>
                      {i.kind.replaceAll("_", " ")}: {i.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 border-t border-line pt-2">
                <div className="mb-1 text-[11px] font-medium text-faint">Provenance</div>
                <ul className="space-y-1 text-[11.5px]">
                  {q.occurrences.map((o) => {
                    const edit = manualEditOf(o);
                    return (
                      <li key={o.sourceKey} className="flex flex-wrap items-center gap-2" data-testid="q-provenance">
                        <Badge tone={ctx.sources.find((s) => s.id === o.sourceId)?.kind === "pdf" ? "accent" : "violet"}>{`${sourceName(o.sourceId)} Q${o.sourceQnum}`}</Badge>
                        {o.page && <span className="text-muted">page {o.page}</span>}
                        {o.url && (
                          <a href={o.url} target="_blank" rel="noreferrer" className="max-w-[260px] truncate text-muted hover:text-accent">
                            {o.url}
                          </a>
                        )}
                        <span className="text-faint">
                          {o.extractionMethod.replaceAll("_", " ")} · {Math.round(o.extractionConfidence * 100)}%
                        </span>
                        {o.id === q.primaryOccurrenceId && <span className="text-faint">· shown text</span>}
                        {edit && <span className="text-accent">edited by {edit.by} {relTime(edit.at)}</span>}
                        {!isValidOccurrence(o) && <span className="text-bad">incomplete</span>}
                        {ctx.canEdit && (
                          <span className="ml-auto">
                            <ExcludeToggle versionId={vid} sourceKey={o.sourceKey} excluded={false} />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Card>
          );
        })}
      </div>
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-3 text-xs" aria-label="Pages">
          {current > 1 ? <Link href={link({ page: current - 1 })} className="text-accent hover:underline">← Previous</Link> : <span className="text-faint">← Previous</span>}
          <span className="text-muted">
            Page {current} of {pages}
          </span>
          {current < pages ? <Link href={link({ page: current + 1 })} className="text-accent hover:underline">Next →</Link> : <span className="text-faint">Next →</span>}
        </nav>
      )}
    </div>
  );
}

type Occ = { sourceKey: string; sourceId: string; sourceQnum: number; page: number | null; url: string | null; stem: string; options: string; answerLabels: string; canonical: { code: string } | null };

function OccPanel({ o, ctx }: { o: Occ | undefined; ctx: Ctx }) {
  if (!o) return <div className="text-xs text-faint">Missing occurrence</div>;
  const opts = parseJson<{ label: string; text: string }[]>(o.options, []);
  const ans = parseJson<string[]>(o.answerLabels, []);
  return (
    <div className="min-w-0 text-xs">
      <div className="mb-1 flex items-center gap-2 text-[11px] text-muted">
        <Badge tone={ctx.sources.find((x) => x.id === o.sourceId)?.kind === "pdf" ? "accent" : "violet"}>{`${ctx.sources.find((x) => x.id === o.sourceId)?.name ?? o.sourceId} Q${o.sourceQnum}`}</Badge>
        {o.page && <span>page {o.page}</span>}
        {o.canonical && (
          <QCode ctx={ctx} code={o.canonical.code} className="hover:text-accent" />
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

async function Duplicates({ filter, ctx }: { filter: string; ctx: Ctx }) {
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
  const cands = await prisma.duplicateCandidate.findMany({ where: { versionId: ctx.vid, ...where }, orderBy: [{ status: "asc" }, { score: "desc" }], take: 120 });
  const keys = [...new Set(cands.flatMap((c) => [c.aKey, c.bKey]))];
  const occs = await prisma.sourceOccurrence.findMany({ where: { versionId: ctx.vid, sourceKey: { in: keys } }, select: { sourceKey: true, sourceId: true, sourceQnum: true, page: true, url: true, stem: true, options: true, answerLabels: true, canonical: { select: { code: true } } } });
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
          <Link key={f.id} href={ctx.tabHref(`tab=duplicates&status=${f.id}`)} className={cn("rounded-lg border px-2.5 py-1 text-xs", filter === f.id ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg-2")}>
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
              <OccPanel o={byKey.get(c.aKey)} ctx={ctx} />
              <OccPanel o={byKey.get(c.bKey)} ctx={ctx} />
            </div>
            <div className="mt-3 border-t border-line pt-3">
              {ctx.canEdit && <DuplicateButtons versionId={ctx.vid} pairKey={c.pairKey} status={c.status} previousStatus={c.previousStatus} />}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

async function Answers({ ctx }: { ctx: Ctx }) {
  const qs = await prisma.canonicalQuestion.findMany({
    where: { versionId: ctx.vid, active: true, OR: [{ verification: { in: ["conflict", "contested", "unknown"] } }, { claims: { some: { kind: "user_override" } } }] },
    include: { claims: true, options: { orderBy: { order: "asc" } } },
    orderBy: [{ verification: "asc" }, { code: "asc" }],
  });
  return (
    <div>
      <p className="mb-4 text-xs text-muted">
        These questions have disagreeing answer keys, disputed community votes or no key. They are not graded until an administrator resolves them in a draft. Setting an answer creates a reviewer-verified claim that learners get when the draft is published. Check the official documentation before deciding.
      </p>
      {qs.length === 0 && <EmptyState title="No answer conflicts" />}
      <div className="flex flex-col gap-3">
        {qs.map((q) => {
          const override = q.claims.find((c) => c.kind === "user_override");
          return (
            <Card key={q.id} className="p-4" data-testid="conflict-card">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <QCode ctx={ctx} code={q.code} className="font-mono font-semibold text-fg hover:text-accent" />
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
                {ctx.canEdit && <AnswerResolver questionId={q.id} labels={q.options.map((o) => o.label)} current={override ? parseJson<string[]>(override.labels, []) : null} hasOverride={!!override} />}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

async function Issues({ kind, status, ctx }: { kind?: string; status: string; ctx: Ctx }) {
  const kinds = await prisma.importIssue.groupBy({ by: ["kind"], where: { versionId: ctx.vid, active: true, status: "open" }, _count: true });
  const issues = await prisma.importIssue.findMany({
    where: { versionId: ctx.vid, active: true, ...(kind ? { kind } : {}), ...(status === "all" ? {} : { status }) },
    include: { question: { select: { code: true } } },
    orderBy: [{ severity: "desc" }, { kind: "asc" }, { issueKey: "asc" }],
    take: 300,
  });
  const link = (p: Record<string, string | undefined>) => ctx.tabHref(new URLSearchParams(Object.entries({ tab: "issues", kind, status, ...p }).filter(([, v]) => v) as [string, string][]).toString());
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
                  <QCode ctx={ctx} code={i.question.code} className="font-mono text-fg-2 hover:text-accent" />
                )}
                <span className="min-w-0 flex-1 text-fg-2">{i.message}</span>
                {i.resolution && <span className="text-faint">{i.resolution}</span>}
                {ctx.canEdit && <IssueButtons versionId={ctx.vid} issueKey={i.issueKey} status={i.status} />}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

async function Classification({ ctx }: { ctx: Ctx }) {
  const [qs, objectives] = await Promise.all([
    prisma.canonicalQuestion.findMany({ where: { versionId: ctx.vid, active: true, OR: [{ classificationStatus: "unmapped" }, { classificationConfidence: "low" }, { classificationStatus: "manual" }] }, orderBy: [{ classificationStatus: "desc" }, { classificationConfidenceValue: "asc" }] }),
    prisma.examObjective.findMany({ where: { versionId: ctx.vid }, orderBy: { order: "asc" }, select: { code: true, title: true } }),
  ]);
  return (
    <div>
      <p className="mb-4 text-xs text-muted">Questions the keyword classifier could not map, or mapped with low confidence. Assign the objective you believe is correct; manual choices are copied into later drafts.</p>
      <Card>
        <div className="divide-y divide-line">
          {qs.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-xs">
              <QCode ctx={ctx} code={q.code} className="font-mono text-fg-2 hover:text-accent" />
              <Badge tone={q.classificationStatus === "unmapped" ? "warn" : q.classificationStatus === "manual" ? "ok" : "neutral"}>{q.classificationStatus === "mapped" ? `low · ${q.objectiveCode}` : q.classificationStatus}</Badge>
              <span className="min-w-0 flex-1 truncate text-muted" title={q.classificationExplanation}>
                {q.stem.replace(/\[\[img:\d+\]\]/g, "")}
              </span>
              {ctx.canEdit ? <ClassificationPicker questionId={q.id} current={q.objectiveCode} objectives={objectives} /> : <span className="font-mono text-[12px] text-muted">{q.objectiveCode ?? "unmapped"}</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

async function Legacy({ ctx }: { ctx: Ctx }) {
  const qs = await prisma.canonicalQuestion.findMany({ where: { versionId: ctx.vid, active: true, legacyStatus: { in: [...LEGACY_FLAGGED] } }, orderBy: [{ legacyStatus: "asc" }, { code: "asc" }] });
  return (
    <div>
      <p className="mb-4 text-xs text-muted">Questions that mention retired products, deprecated features or patterns the current exam guide no longer emphasizes. The concepts may still apply, but answer choices can reflect old product behaviour. These are excluded from mock exams by default.</p>
      <Card>
        <div className="divide-y divide-line">
          {qs.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-xs">
              <QCode ctx={ctx} code={q.code} className="font-mono text-fg-2 hover:text-accent" />
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

async function Imports({ ctx }: { ctx: Ctx }) {
  const [runs, inv, sourceRows] = await Promise.all([
    prisma.importRun.findMany({ where: { versionId: ctx.vid }, orderBy: { startedAt: "desc" }, take: 30 }),
    computeInventory(prisma, ctx.vid),
    prisma.questionSource.findMany({ where: { versionId: ctx.vid }, orderBy: [{ kind: "asc" }, { id: "asc" }] }),
  ]);
  const run = runs.find((r) => r.status === "succeeded" || r.status === "completed");
  const report = parseJson<RunSummary>(run?.summary ?? "{}", {});
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted">
        Imports only ever write into draft versions: source occurrences are upserted by source key, canonical codes stay stable across versions, reviewer decisions are kept, and learner progress is never touched. New uploads and URLs are processed from Data Settings.
      </p>
      {sourceRows.length > 0 && (
        <div className="flex items-center gap-2 text-sm font-medium text-fg" data-testid="inventory-identity-check">
          {inv.identityHolds ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-bad" />}
          Unique = {inv.sources.map((x) => x.name).join(" + ")} − overlap: {inv.sources.map((x) => x.occurrences).join(" + ")} − {inv.sourceOccurrences - inv.uniqueQuestions} = {inv.uniqueQuestions}
          <span className="text-muted">({inv.uniqueQuestions} canonical questions in this version)</span>
        </div>
      )}
      {sourceRows.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2" data-testid="extraction-reports">
          {sourceRows.map((src) => {
            const rep = report.sources?.[src.id] ?? {};
            const facts: [string, unknown][] = [
              ["Kind", src.kind],
              ["Declared / extracted", `${src.declaredCount ?? "?"} / ${inv.sources.find((x) => x.id === src.id)?.occurrences ?? src.extractedCount}`],
              ["Only in this source", inv.sources.find((x) => x.id === src.id)?.only ?? 0],
              ...Object.entries(rep).filter(([k, val]) => !["file", "url", "access_notes"].includes(k) && (typeof val !== "object" || Array.isArray(val))),
            ];
            return (
              <Card key={src.id}>
                <CardHeader title={`${src.name} extraction`} subtitle={src.url ?? src.fileName ?? undefined} />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-5 pb-5 text-xs">
                  {facts.map(([k, val]) => (
                    <div key={k} className="flex justify-between gap-3 border-b border-line/50 py-1">
                      <dt className="text-muted">{k.replaceAll("_", " ")}</dt>
                      <dd className="text-right text-fg-2 tabular-nums">{fmtValue(val)}</dd>
                    </div>
                  ))}
                </dl>
                {typeof rep.access_notes === "string" && <p className="px-5 pb-5 text-[11px] text-faint">{rep.access_notes}</p>}
              </Card>
            );
          })}
        </div>
      )}
      <Card>
        <div className="divide-y divide-line">
          {runs.map((r) => {
            const s = parseJson<RunSummary>(r.summary, {});
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-xs">
                <span className="font-mono text-fg-2">#{r.id}</span>
                <Badge tone={r.status === "completed" || r.status === "succeeded" ? "ok" : r.status === "failed" ? "bad" : "warn"}>{r.status}</Badge>
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
