import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Circle, CircleDot, XCircle } from "lucide-react";
import { CertMetaForm, JobsAutoRefresh, NewDraftForm, PdfSourceForm, SourceActions, StartProcessingButton, UrlSourceForm, VersionActions } from "@/components/data-settings";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { adminStepUp } from "@/lib/auth";
import { certAdminPage } from "@/lib/cert";
import { inCert, isEditableStatus, VERSION_STATUS_LABEL, type VersionStatus } from "@/lib/cert-rules";
import { prisma } from "@/lib/db";
import { INGEST_ERRORS, type IngestErrorCode } from "@/lib/ingest/types";
import { parseJson } from "@/lib/json";
import { type DraftQuality, lifecycle, loadDraftQuality, type SourceRow, type StepState } from "@/lib/quality";
import { cn, relTime } from "@/lib/utils";

type SP = Record<string, string | string[] | undefined>;
type Tone = "ok" | "warn" | "bad" | "neutral" | "accent" | "outline" | "violet";
type SourceSummary = { key: string; name: string; kind: string; url: string | null; fileName: string | null; extractedCount: number; retrievedAt: string | null };

const STATUS_TONE: Record<string, Tone> = { draft: "warn", review: "accent", published: "ok", archived: "outline" };
const STATE: Record<string, { label: string; tone: Tone }> = {
  waiting: { label: "Waiting to start", tone: "neutral" },
  queued: { label: "Queued", tone: "accent" },
  retry_scheduled: { label: "Retry scheduled", tone: "warn" },
  processing: { label: "Processing", tone: "accent" },
  processed: { label: "Processed", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  copied: { label: "Copied", tone: "outline" },
};
const fmtDate = (d: Date | null) => (d ? d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "–");
const fmtSize = (n: number | null) => (n === null ? "" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Per-certification content administration: versions, sources and processing, data quality, review and publish. */
export default async function DataSettingsPage({ params, searchParams }: { params: Promise<{ cert: string }>; searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { user, cert, base, version: published } = await certAdminPage(params);
  if (!user.isAdmin) notFound();
  const L = (h: string) => inCert(base, h);
  const can = user.canManageContent;

  const [versions, jobs, events, certRow] = await Promise.all([
    prisma.contentVersion.findMany({ where: { certificationId: cert.id }, orderBy: { createdAt: "desc" } }),
    prisma.ingestionJob.findMany({ where: { certificationId: cert.id }, orderBy: { createdAt: "desc" }, take: 30, include: { version: { select: { label: true } } } }),
    prisma.auditEvent.findMany({ where: { certificationId: cert.id }, orderBy: { at: "desc" }, take: 40 }),
    prisma.certification.findUniqueOrThrow({ where: { id: cert.id }, select: { currentVersionId: true } }),
  ]);
  const editable = versions.filter((v) => isEditableStatus(v.status));
  const requested = typeof sp.draft === "string" ? editable.find((v) => v.id === sp.draft) : undefined;
  const draft = requested ?? editable[0] ?? null;
  const q = draft ? await loadDraftQuality(prisma, draft.id) : null;
  const pubFull = published ? (versions.find((v) => v.id === published.id) ?? null) : null;
  const pubSources = parseJson<SourceSummary[]>(pubFull?.sources, []);
  const busy = jobs.some((j) => j.status === "queued" || j.status === "processing");
  const label = (id: string | null) => versions.find((v) => v.id === id)?.label ?? null;
  const year = new Date().getFullYear();
  const suggested = [String(year), String(year + 1), `${year}-r2`].find((l) => !versions.some((v) => v.label === l)) ?? `${year}-r${versions.length + 1}`;

  return (
    <div className="animate-in">
      <JobsAutoRefresh active={busy} />
      <PageHeader
        title="Data Settings"
        description={`${cert.name}${cert.provider ? ` · ${cert.provider}` : ""}. Content changes happen in a draft version and reach learners only when it is reviewed and published. Published versions are never edited or deleted.`}
      />
      {!can && (
        <div className="mb-5 rounded-lg border border-warn/30 bg-warn-soft px-4 py-2.5 text-[12.5px] text-warn" data-testid="data-readonly">
          {adminStepUp().mode === "disabled" ? (
            "Administration is disabled on this server until ADMIN_ACCESS_CODE is configured. This page is read-only."
          ) : (
            <>
              Read-only until you confirm your administrator access code in{" "}
              <Link href="/settings#admin-access" className="underline">
                Settings
              </Link>
              .
            </>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Versions" subtitle="One version per exam guide year or correction. Draft → In review → Published; publishing archives the previous version and keeps its learner progress as history." />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" data-testid="versions">
                <thead className="border-y border-line text-[11px] text-faint">
                  <tr>
                    <th className="px-5 py-2 font-medium">Version</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 text-right font-medium">Questions</th>
                    <th className="px-2 py-2 font-medium">Based on</th>
                    <th className="px-2 py-2 font-medium">Last change</th>
                    <th className="px-5 py-2 text-right font-medium">Open</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {versions.map((v) => {
                    const isDraft = isEditableStatus(v.status);
                    const selected = draft?.id === v.id;
                    return (
                      <tr key={v.id} className={cn(selected && "bg-accent-soft/40")} data-testid={`version-${v.label}`}>
                        <td className="px-5 py-2.5 text-[13px] font-semibold text-fg">{v.label}</td>
                        <td className="px-2 py-2.5">
                          <span className="flex items-center gap-1.5">
                            <Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{VERSION_STATUS_LABEL[v.status as VersionStatus] ?? v.status}</Badge>
                            {v.id === certRow.currentVersionId && <Badge tone="ok">live</Badge>}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right text-fg-2 tabular-nums">{v.questionCount}</td>
                        <td className="px-2 py-2.5 text-muted">{v.basedOnId ? (label(v.basedOnId) ?? "earlier version") : "–"}</td>
                        <td className="px-2 py-2.5 text-faint">{v.publishedAt ? `published ${relTime(v.publishedAt)}` : v.submittedAt ? `submitted ${relTime(v.submittedAt)}` : `created ${relTime(v.createdAt)}`}</td>
                        <td className="px-5 py-2.5 text-right whitespace-nowrap">
                          {isDraft ? (
                            selected ? (
                              <span className="text-faint">open below</span>
                            ) : (
                              <Link href={L(`/data?draft=${v.id}`)} className="text-accent hover:underline" data-testid={`open-draft-${v.label}`}>
                                Open draft
                              </Link>
                            )
                          ) : (
                            <span className="flex justify-end gap-3">
                              {v.id === certRow.currentVersionId && (
                                <Link href={L("/questions")} className="text-accent hover:underline">
                                  Questions
                                </Link>
                              )}
                              <Link href={L(`/data-quality${v.id === published?.id ? "" : `?version=${v.id}`}`)} className="text-muted hover:text-fg-2">
                                Data quality
                              </Link>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {versions.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-4 text-muted">
                        No versions yet. Create the first draft below.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {can && (
              <div className="border-t border-line px-5 py-4">
                <NewDraftForm certificationId={cert.id} hasPublished={!!published} suggested={suggested} labels={versions.map((v) => v.label)} />
              </div>
            )}
          </Card>

          {draft && q ? (
            <DraftWorkspace draft={draft} q={q} can={can} L={L} basedOn={label(draft.basedOnId)} expectedCurrentId={certRow.currentVersionId} />
          ) : (
            <EmptyState title="No draft in progress" description={published ? "Create a draft to correct or update the published content. Learners keep studying the published version meanwhile." : "Create the first draft to start adding sources."} />
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card className="p-5" data-testid="published-summary">
            <div className="mb-3 text-xs font-medium text-fg-2">Live for learners</div>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Published version" value={published?.label ?? "None"} hint={published?.publishedAt ? `${published.publishedAt.toLocaleDateString()} by ${published.publishedBy ?? "–"}` : "Learners cannot see this certification yet"} />
              <Stat label="Questions" value={published?.questionCount ?? 0} />
            </div>
            {pubSources.length > 0 && (
              <ul className="mt-3 space-y-1 text-[11.5px] text-muted">
                {pubSources.map((s) => (
                  <li key={s.key} className="truncate">
                    {s.name} <span className="text-faint">· {s.kind} · {s.extractedCount} source questions</span>
                  </li>
                ))}
              </ul>
            )}
            {pubFull?.fingerprint && <p className="mt-3 font-mono text-[10.5px] text-faint">fingerprint {pubFull.fingerprint.slice(0, 16)}…</p>}
          </Card>
          {can && <CertMetaForm certificationId={cert.id} initial={{ name: cert.name, provider: cert.provider, description: cert.description, status: cert.status as "active" | "archived" }} />}
          <Card>
            <details>
              <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-fg">Processing history</summary>
              <ol className="max-h-[420px] space-y-2 overflow-y-auto px-5 pb-5 text-[11.5px]" data-testid="jobs">
                {jobs.map((j) => (
                  <li key={j.id} data-testid="job-row">
                    <span className="text-fg-2">{j.sourceName}</span> <span className="text-faint">→ {j.version?.label ?? "deleted draft"}</span>
                    <div className="text-faint">
                      {j.status.replace("_", " ")} · {j.kind} · attempt {j.attempts}/{j.maxAttempts}
                      {j.extractedCount ? ` · ${j.validCount}/${j.extractedCount} valid` : ""} · {relTime(j.createdAt)}
                    </div>
                  </li>
                ))}
                {!jobs.length && <li className="text-muted">No sources have been processed yet.</li>}
              </ol>
            </details>
          </Card>
          <Card>
            <details>
              <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-fg">Change history</summary>
              <ol className="max-h-[420px] space-y-2 overflow-y-auto px-5 pb-5 text-[11.5px]" data-testid="audit">
                {events.map((e) => (
                  <li key={e.id}>
                    <span className="text-fg-2">{e.action.replace(".", " · ").replaceAll("_", " ")}</span>
                    {e.versionId && label(e.versionId) ? <span className="text-muted"> ({label(e.versionId)})</span> : null}
                    <div className="text-faint">
                      {e.actor} · {fmtDate(e.at)}
                    </div>
                  </li>
                ))}
                {!events.length && <li className="text-muted">No changes recorded yet.</li>}
              </ol>
            </details>
          </Card>
        </div>
      </div>
    </div>
  );
}

type Draft = { id: string; label: string; status: string; basedOnId: string | null };

function DraftWorkspace({ draft, q, can, L, basedOn, expectedCurrentId }: { draft: Draft; q: DraftQuality; can: boolean; L: (h: string) => string; basedOn: string | null; expectedCurrentId: string | null }) {
  const steps = lifecycle(q, draft.status);
  const waiting = q.sources.filter((s) => s.state === "waiting").length;
  const scheduled = q.sources.filter((s) => s.state === "retry_scheduled").length;
  const running = q.sources.filter((s) => s.state === "processing" || s.state === "queued").length;
  const dq = (tab: string) => L(`/data-quality?tab=${tab}&version=${draft.id}`);
  const next = nextSteps(q, draft.status, dq);
  return (
    <section className="flex flex-col gap-6" data-testid="draft-panel">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-2">
          <h2 className="text-base font-semibold text-fg">Draft {draft.label}</h2>
          <Badge tone={STATUS_TONE[draft.status] ?? "neutral"}>{VERSION_STATUS_LABEL[draft.status as VersionStatus] ?? draft.status}</Badge>
          <span className="text-xs text-muted">{basedOn ? `Based on ${basedOn}; changed questions start fresh for learners after publishing.` : "New content; learners start fresh when it is published."}</span>
        </div>
        <ol className="grid gap-2 sm:grid-cols-5" data-testid="lifecycle">
          {steps.map((s, i) => (
            <li key={s.id} className={cn("rounded-lg border px-3 py-2", s.state === "current" ? "border-accent/50 bg-accent-soft" : s.state === "blocked" ? "border-bad/40 bg-bad-soft" : "border-line")} data-testid={`step-${s.id}`} data-state={s.state}>
              <div className="flex items-center gap-1.5 text-xs font-medium text-fg">
                <StepIcon state={s.state} />
                <span className="text-faint">{i + 1}.</span> {s.label}
              </div>
              <div className="mt-0.5 text-[11px] text-muted">{s.detail}</div>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardHeader
          title="Sources"
          subtitle="Each source is processed on its own and combined into one question set. Adding a source does not process it."
          action={can ? <StartProcessingButton versionId={draft.id} waiting={waiting} scheduled={scheduled} running={running} /> : undefined}
        />
        {q.sources.length ? (
          <div className="divide-y divide-line border-t border-line" data-testid="draft-sources">
            {q.sources.map((s) => (
              <SourceItem key={s.key} s={s} can={can} versionId={draft.id} basedOn={basedOn} />
            ))}
          </div>
        ) : (
          <p className="border-t border-line px-5 py-4 text-xs text-muted" data-testid="no-sources">
            No sources yet. Add a PDF or a website below, then click Start processing.
          </p>
        )}
        {can && (
          <div className="grid gap-4 border-t border-line px-5 py-4 md:grid-cols-2" data-testid="add-sources">
            <PdfSourceForm versionId={draft.id} />
            <UrlSourceForm versionId={draft.id} />
          </div>
        )}
        <details className="border-t border-line px-5 py-3 text-xs text-muted">
          <summary className="cursor-pointer text-fg-2">What happens when a source is processed?</summary>
          <div className="mt-2 space-y-1.5 leading-relaxed">
            <p>
              Each source gets an <span className="text-fg-2">ingestion job</span>: a background task that runs after you click Start processing. Sources are processed one at a time, so the page stays usable; it refreshes itself while work is running.
            </p>
            <p>
              The job extracts questions (PDF text first, OCR for scanned pages; for websites plain HTTP first, then a headless browser if needed), checks every question (a stem, at least two options, an answer that matches an option), compares it with every other source in the draft to find duplicates, and writes the result into this draft only.
            </p>
            <p>Temporary failures (timeouts, server errors) are retried automatically up to three times. Permanent ones (blocked by robots.txt, sign-in required, no questions recognised) stop with an explanation. Retrying or re-adding a source replaces its questions; it never duplicates them.</p>
          </div>
        </details>
      </Card>

      <Card data-testid="quality-summary">
        <CardHeader
          title="Data quality"
          subtitle="Counts for this draft, computed from the stored questions."
          action={
            <Link href={L(`/data-quality?version=${draft.id}`)} className="text-xs text-accent hover:underline" data-testid="open-data-quality">
              Open Exam Coverage &amp; Quality →
            </Link>
          }
        />
        <div className="grid grid-cols-2 gap-4 px-5 pb-4 md:grid-cols-4 xl:grid-cols-8">
          <Stat label="Questions" value={q.questions.total} tone="accent" hint={`${q.extracted.total} extracted`} />
          <Stat label="Valid" value={q.extracted.valid} tone={q.extracted.valid ? "ok" : undefined} />
          <Stat label="Invalid" value={q.extracted.invalid} tone={q.extracted.invalid ? "bad" : undefined} />
          <Stat label="Duplicates merged" value={q.duplicates.merged} hint={q.questions.multiSource ? `${q.questions.multiSource} in 2+ sources` : undefined} />
          <Stat label="Duplicates to decide" value={q.duplicates.pending} tone={q.duplicates.pending ? "warn" : undefined} />
          <Stat label="Blocking issues" value={q.issues.error} tone={q.issues.error ? "bad" : "ok"} hint={q.issues.warning ? `${q.issues.warning} warnings` : undefined} />
          <Stat label="Mapped" value={q.questions.mapped} hint={`${q.questions.unmapped} unmapped`} />
          <Stat label="Gradable" value={q.questions.gradable} hint={`${q.questions.ungradable} without answer`} tone={q.questions.ungradable ? "warn" : undefined} />
        </div>
        {next.length > 0 && (
          <div className="border-t border-line px-5 py-3" data-testid="next-steps">
            <div className="mb-1.5 text-xs font-medium text-fg-2">Next steps</div>
            <ul className="space-y-1 text-xs">
              {next.map((n) => (
                <li key={n.text} className="flex items-start gap-2">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.blocking ? "bg-bad" : "bg-warn")} />
                  <span className="text-fg-2">
                    {n.text}
                    {n.href && (
                      <>
                        {" "}
                        <Link href={n.href} className="text-accent hover:underline">
                          {n.link}
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card data-testid="review-publish">
        <CardHeader title="Review and publish" subtitle="Submit for review freezes the content (any change returns it to draft). Publish makes it the version learners see; the previous version is archived, never overwritten." />
        <div className="px-5 pb-5">
          <ul className="mb-4 space-y-1.5 text-xs" data-testid="readiness">
            {q.readiness.errors.map((e) => (
              <li key={e} className="flex items-start gap-2 text-bad">
                <XCircle className="mt-0.5 size-3.5 shrink-0" /> <span>Blocks publishing: {e}</span>
              </li>
            ))}
            {q.readiness.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> <span>{w}</span>
              </li>
            ))}
            {!q.readiness.errors.length && (
              <li className="flex items-start gap-2 text-ok">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                <span>{draft.status === "review" ? "Reviewed and ready to publish." : `Ready for review${q.readiness.warnings.length ? " (warnings above do not block publishing)" : ""}.`}</span>
              </li>
            )}
          </ul>
          {can && <VersionActions versionId={draft.id} status={draft.status} label={draft.label} expectedCurrentId={expectedCurrentId} blockers={q.readiness.errors.length} />}
        </div>
      </Card>
    </section>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <CheckCircle2 className="size-3.5 text-ok" />;
  if (state === "current") return <CircleDot className="size-3.5 text-accent" />;
  if (state === "blocked") return <XCircle className="size-3.5 text-bad" />;
  return <Circle className="size-3.5 text-faint" />;
}

function SourceItem({ s, can, versionId, basedOn }: { s: SourceRow; can: boolean; versionId: string; basedOn: string | null }) {
  const st = STATE[s.state] ?? { label: s.state, tone: "neutral" as Tone };
  const job = s.job;
  const help = job?.errorCode && job.errorCode in INGEST_ERRORS ? INGEST_ERRORS[job.errorCode as IngestErrorCode].help : null;
  const lastStage = job?.stages.at(-1);
  const intake = s.kind === "website" ? "URL added" : job ? `Uploaded${s.fileSize ? ` · ${fmtSize(s.fileSize)}` : ""}` : `From ${basedOn ?? "earlier version"}`;
  return (
    <div className="px-5 py-3 text-xs" data-testid="source-row" data-source={s.key} data-state={s.state}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={s.kind === "pdf" ? "accent" : s.kind === "website" ? "violet" : "outline"}>{s.kind === "website" ? "website" : s.kind}</Badge>
        <span className="text-[13px] font-medium text-fg">{s.name}</span>
        <span className="text-faint">{intake}</span>
        <Badge tone={st.tone}>{s.state === "copied" ? `Copied from ${basedOn ?? "earlier version"}` : st.label}</Badge>
        {s.state === "processing" && lastStage && <span className="text-muted">stage: {lastStage.stage.replaceAll("_", " ")}</span>}
        {s.state === "retry_scheduled" && job && <span className="text-muted">next attempt {job.nextRunAt.toLocaleTimeString()}</span>}
        {can && <span className="ml-auto">{<SourceActions versionId={versionId} sourceKey={s.key} name={s.name} jobId={job?.id ?? null} jobStatus={job?.status ?? null} state={s.state} />}</span>}
      </div>
      {(s.url || s.fileName) && <div className="mt-0.5 truncate text-faint">{s.url ?? s.fileName}</div>}
      {(s.extracted > 0 || s.state === "processed" || s.state === "copied") && (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-muted" data-testid="source-counts">
          <span>
            <span className="font-medium text-fg-2 tabular-nums">{s.extracted}</span> extracted
          </span>
          <span>
            <span className={cn("font-medium tabular-nums", s.invalid ? "text-bad" : "text-fg-2")}>{s.valid}</span> valid{s.invalid ? `, ${s.invalid} invalid` : ""}
          </span>
          {s.shared > 0 && <span>{s.shared} also in another source</span>}
          {s.lowConfidence > 0 && <span className="text-warn">{s.lowConfidence} read by OCR (check manually)</span>}
          {s.edited > 0 && <span>{s.edited} edited</span>}
          {s.excluded > 0 && <span>{s.excluded} excluded</span>}
          {(s.openErrors > 0 || s.openWarnings > 0) && (
            <span className={s.openErrors ? "text-bad" : "text-warn"}>
              {s.openErrors ? `${plural(s.openErrors, "blocking issue")}` : ""}
              {s.openErrors && s.openWarnings ? ", " : ""}
              {s.openWarnings ? plural(s.openWarnings, "warning") : ""}
            </span>
          )}
          {job?.finishedAt && <span className="text-faint">processed {relTime(job.finishedAt)}</span>}
        </div>
      )}
      {job?.error && (
        <p className={cn("mt-1.5", job.status === "failed" ? "text-bad" : "text-warn")} data-testid="job-error">
          {job.errorCode ? `${job.errorCode.replaceAll("_", " ").toLowerCase()}: ` : ""}
          {job.error}
          {help && help !== job.error ? <span className="block text-muted">{help}</span> : null}
          {job.status === "failed" && s.extracted > 0 && <span className="block text-muted">The questions shown are from this source&apos;s last successful run.</span>}
        </p>
      )}
      {job && job.warnings.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-warn">
          {job.warnings.slice(0, 4).map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {job && job.stages.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-faint">
            Details: attempt {job.attempts} of {job.maxAttempts} · {job.stages.map((x) => `${x.stage.replaceAll("_", " ")} ${x.status}`).join(" → ")}
            {s.history.length > 1 ? ` · ${plural(s.history.length, "run")}` : ""}
          </summary>
          <ol className="mt-1 space-y-0.5 pl-4 text-faint">
            {job.stages.map((x, i) => (
              <li key={i}>
                <span className={x.status === "succeeded" ? "text-ok" : x.status === "failed" ? "text-bad" : "text-muted"}>{x.status}</span> {x.stage.replaceAll("_", " ")}
                {x.method ? ` (${x.method})` : ""}
                {x.detail ? ` · ${x.detail}` : ""}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

type Next = { text: string; href?: string; link?: string; blocking?: boolean };

function nextSteps(q: DraftQuality, status: string, dq: (tab: string) => string): Next[] {
  const out: Next[] = [];
  const by = (state: string) => q.sources.filter((s) => s.state === state).length;
  if (!q.sources.length) out.push({ text: "Add a PDF or a website as a source.", blocking: true });
  if (by("waiting")) out.push({ text: `${plural(by("waiting"), "source")} added but not processed. Click Start processing.`, blocking: true });
  if (by("processing") + by("queued") + by("retry_scheduled")) out.push({ text: `${plural(by("processing") + by("queued") + by("retry_scheduled"), "source")} being processed; this page updates automatically.` });
  if (by("failed")) out.push({ text: `${plural(by("failed"), "source")} failed. Read the error on the source, then Retry or Remove it.` });
  if (q.duplicates.pending) out.push({ text: `Decide ${plural(q.duplicates.pending, "possible duplicate pair")} (they stay separate questions until you decide).`, href: dq("duplicates"), link: "Review duplicates" });
  if (q.issues.error) out.push({ text: `Resolve or ignore ${plural(q.issues.error, "blocking review item")}${q.readiness.stats.lowConfidence ? `, including ${q.readiness.stats.lowConfidence} OCR-read question(s) to check against the source` : ""}.`, href: dq("issues"), link: "Open review queue", blocking: true });
  if (q.extracted.invalid) out.push({ text: `${plural(q.extracted.invalid, "extracted question")} ${q.extracted.invalid === 1 ? "is" : "are"} incomplete (missing options or an answer that matches no option). Edit or exclude them.`, href: dq("questions"), link: "Review questions" });
  if (q.questions.conflicts) out.push({ text: `${plural(q.questions.conflicts, "question")} with sources that disagree on the answer.`, href: dq("answers"), link: "Resolve answers" });
  if (q.questions.ungradable && !q.questions.conflicts) out.push({ text: `${plural(q.questions.ungradable, "question")} without a verified answer; learners only get provisional feedback.`, href: dq("answers"), link: "Set answers" });
  if (q.readiness.stats.objectives === 0 && q.questions.total) out.push({ text: "This draft has no exam objectives, so questions cannot be mapped to a blueprint. That does not block publishing (objectives are imported with the exam guide, which this screen does not edit)." });
  else if (q.questions.unmapped) out.push({ text: `${plural(q.questions.unmapped, "question")} not mapped to an exam objective.`, href: dq("classification"), link: "Map questions" });
  if (!q.readiness.errors.length && status === "draft") out.push({ text: "Everything blocking is resolved: submit the draft for review below." });
  if (status === "review") out.push({ text: "In review: publish below, or return it to draft to make changes." });
  return out;
}
