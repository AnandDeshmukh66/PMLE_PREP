/**
 * Idempotent import of the PMLE bank (data/processed/bank.json) into a draft content version.
 * Upserts content tables of that version only. User activity is never touched; reviewer duplicate
 * decisions and issue resolutions are kept. Published versions are never modified.
 *
 *   npx tsx scripts/import-db.ts [--bank path] [--version <draftId>] [--publish]
 *
 * --publish submits and publishes the draft afterwards; `npm run setup` uses it to bootstrap a fresh database.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { rebuildCanonicals } from "../lib/canonicalize";
import { isEditableStatus, LEGACY_PMLE_SLUG, LEGACY_PMLE_VERSION_ID } from "../lib/cert-rules";
import { sha256 } from "../lib/fingerprint";
import { computeInventory } from "../lib/inventory";
import { parseJson } from "../lib/json";
import { refreshReviewQueue } from "../lib/review-queue";
import { assertEditable, ensureFingerprints, publishVersion, refreshVersionStats, submitForReview, VersionError } from "../lib/versions";

const ROOT = path.resolve(__dirname, "..");

type Bank = {
  generated_at: string;
  taxonomy: { source_url: string; weights_sum_percent: number; domains: { number: number; title: string; weight_percent: number | null; objectives: { code: string; title: string; considerations: string[] }[] }[] };
  concepts: { id: string; domain: number; objective: string; secondaryObjectives?: string[]; category: string; name: string; description: string; priority: string; guideStatus: string; keywords: string[] }[];
  sources: {
    source: "pdf" | "examprepper";
    source_key: string;
    source_qnum: number;
    page: number | null;
    page_start?: number;
    page_end?: number;
    url: string | null;
    origin_url?: string | null;
    topic_label?: string | null;
    stem: string;
    options: { label: string; text: string }[];
    claims: unknown[];
    answer_primary: string[];
    explanation: string | null;
    discussion: unknown[];
    images: unknown[];
    raw_text?: string | null;
    raw?: unknown;
    issues: string[];
    extraction_confidence: number;
    content_hash: string;
    stem_hash: string;
    legacy_status: string;
    legacy_hits: { severity: number }[];
    classification: { status: string; confidence: string };
  }[];
  duplicate_pairs: { a: string; b: string; stage: string; score: number; stem_ratio: number; option_sim: number; cosine?: number; number_mismatch?: string[]; answers_agree?: boolean; decision: string; reason: string }[];
  report: Record<string, unknown> & { sources: { pdf: Record<string, unknown>; examprepper: Record<string, unknown>; guide: Record<string, unknown> } };
};

export type ImportOptions = {
  writeReport?: boolean;
  /** Target version. Default: the PMLE version this bank has always populated (created as a draft if missing). */
  versionId?: string;
  /** After importing, submit for review and publish (bootstrapping a fresh database only). */
  publish?: boolean;
  actor?: string;
};

async function targetVersion(db: PrismaClient, versionId?: string) {
  if (versionId) {
    const v = await db.contentVersion.findUnique({ where: { id: versionId } });
    if (!v) throw new Error(`Content version ${versionId} not found.`);
    return v;
  }
  const cert = await db.certification.upsert({
    where: { slug: LEGACY_PMLE_SLUG },
    create: { id: "cert_pmle", slug: LEGACY_PMLE_SLUG, code: "PMLE", name: "Professional Machine Learning Engineer", provider: "Google Cloud" },
    update: {},
  });
  const existing = await db.contentVersion.findUnique({ where: { id: LEGACY_PMLE_VERSION_ID } });
  if (existing) return existing;
  return db.contentVersion.create({ data: { id: LEGACY_PMLE_VERSION_ID, certificationId: cert.id, label: "2026", status: "draft", guideTitle: "Exam guide effective June 1, 2026", createdBy: "import" } });
}

/**
 * Imports the PMLE bank into a draft content version. Published versions are immutable: importing into one is a
 * no-op when the bank is unchanged, and an error otherwise (create a correction draft and import into that).
 */
export async function importBank(db: PrismaClient, bankPath = path.join(ROOT, "data/processed/bank.json"), opts: ImportOptions = {}) {
  const raw = fs.readFileSync(bankPath);
  const bankHash = sha256(raw);
  const bank: Bank = JSON.parse(raw.toString("utf8"));
  const version = await targetVersion(db, opts.versionId);
  const versionId = version.id;
  const last = await db.importRun.findFirst({ where: { versionId, status: "succeeded" }, orderBy: { id: "desc" } });
  const lastHash = last ? parseJson<{ bank_hash?: string }>(last.summary, {}).bank_hash : undefined;
  if (!isEditableStatus(version.status)) {
    if (lastHash === bankHash || (!lastHash && version.status === "published" && versionId === LEGACY_PMLE_VERSION_ID)) {
      return { runId: last?.id ?? null, skipped: true as const, versionId, reason: `Version ${version.label} is ${version.status}; bank unchanged.` };
    }
    throw new VersionError(`Version ${version.label} is ${version.status} and immutable. Create a draft (Data settings → New draft) and import with --version <draftId>.`, "LOCKED");
  }
  if (lastHash === bankHash && !opts.publish) return { runId: last!.id, skipped: true as const, versionId, reason: "Bank unchanged since the last import." };
  await assertEditable(db, versionId);
  const run = await db.importRun.create({ data: { versionId } });

  await db.$transaction(
    async (tx) => {
      const rep = bank.report.sources;
      const pdfData = { name: "PDF question bank", kind: "pdf", fileName: String(rep.pdf.file), declaredCount: Number(rep.pdf.declared_count) || null, extractedCount: Number(rep.pdf.extracted) };
      await tx.questionSource.upsert({ where: { versionId_id: { versionId, id: "pdf" } }, create: { versionId, id: "pdf", ...pdfData }, update: pdfData });
      const epData = { name: "ExamPrepper", kind: "website", url: String(rep.examprepper.url), declaredCount: Number(rep.examprepper.declared_count) || null, extractedCount: Number(rep.examprepper.extracted) };
      await tx.questionSource.upsert({ where: { versionId_id: { versionId, id: "examprepper" } }, create: { versionId, id: "examprepper", ...epData }, update: epData });

      let order = 0;
      for (const d of bank.taxonomy.domains) {
        await tx.examDomain.upsert({ where: { versionId_number: { versionId, number: d.number } }, create: { versionId, number: d.number, title: d.title, weightPercent: d.weight_percent }, update: { title: d.title, weightPercent: d.weight_percent } });
        for (const o of d.objectives) {
          const data = { domainNumber: d.number, title: o.title, considerations: JSON.stringify(o.considerations), order: order++ };
          await tx.examObjective.upsert({ where: { versionId_code: { versionId, code: o.code } }, create: { versionId, code: o.code, ...data }, update: data });
        }
      }
      for (let i = 0; i < bank.concepts.length; i++) {
        const c = bank.concepts[i];
        const data = {
          domainNumber: c.domain,
          objectiveCode: c.objective,
          secondaryObjectives: JSON.stringify(c.secondaryObjectives ?? []),
          category: c.category,
          name: c.name,
          description: c.description,
          priority: c.priority,
          guideStatus: c.guideStatus,
          keywords: JSON.stringify(c.keywords),
          order: i,
        };
        await tx.theoryConcept.upsert({ where: { versionId_id: { versionId, id: c.id } }, create: { versionId, id: c.id, ...data }, update: data });
      }

      for (const s of bank.sources) {
        const data = {
          sourceId: s.source,
          sourceQnum: s.source_qnum,
          page: s.page ?? null,
          pageEnd: s.page_end ?? null,
          url: s.url,
          originUrl: s.origin_url ?? null,
          topicLabel: s.topic_label ?? null,
          stem: s.stem,
          options: JSON.stringify(s.options),
          answerLabels: JSON.stringify(s.answer_primary),
          rawText: s.raw_text ?? null,
          rawJson: s.raw ? JSON.stringify(s.raw) : null,
          explanation: s.explanation,
          discussion: JSON.stringify(s.discussion ?? []),
          images: JSON.stringify(s.images ?? []),
          issues: JSON.stringify(s.issues),
          extractionConfidence: s.extraction_confidence,
          contentHash: s.content_hash,
          stemHash: s.stem_hash,
          legacyStatus: s.legacy_status,
          legacyHits: JSON.stringify(s.legacy_hits),
          classification: JSON.stringify(s.classification),
          claims: JSON.stringify(s.claims),
          lastImportRunId: run.id,
        };
        await tx.sourceOccurrence.upsert({ where: { versionId_sourceKey: { versionId, sourceKey: s.source_key } }, create: { versionId, sourceKey: s.source_key, ...data }, update: data });
      }

      for (const p of bank.duplicate_pairs) {
        const pairKey = `${p.a}|${p.b}`;
        const metrics = {
          aKey: p.a,
          bKey: p.b,
          stage: p.stage,
          score: p.score,
          stemRatio: p.stem_ratio,
          optionSim: p.option_sim,
          cosine: p.cosine ?? null,
          numberMismatch: JSON.stringify(p.number_mismatch ?? []),
          answersAgree: !!p.answers_agree,
          suggestedDecision: p.decision,
          reason: p.reason,
        };
        const where = { versionId_pairKey: { versionId, pairKey } };
        const existing = await tx.duplicateCandidate.findUnique({ where });
        if (!existing) {
          await tx.duplicateCandidate.create({ data: { versionId, pairKey, ...metrics, status: p.decision } });
        } else {
          const userDecided = existing.status === "approved" || existing.status === "rejected";
          await tx.duplicateCandidate.update({ where, data: { ...metrics, ...(userDecided ? {} : { status: p.decision }) } });
        }
      }
    },
    { timeout: 300_000, maxWait: 20_000 },
  );

  const rebuild = await rebuildCanonicals(db, { versionId });
  const missingPages = (bank.report.sources.examprepper.missing_pages as number[]) ?? [];
  await refreshReviewQueue(db, versionId, {
    runId: run.id,
    extra: missingPages.length ? [{ issueKey: "examprepper:missing_pages", kind: "missing_pages", severity: "error", message: `ExamPrepper pages not captured: ${missingPages.join(", ")}` }] : [],
  });
  await refreshVersionStats(db, versionId, { hashes: true });

  const summary = await computeInventory(db, versionId);
  const final = { ...bank.report, final: summary, rebuild, import_run: run.id, bank_hash: bankHash, version_id: versionId };
  await db.importRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: "succeeded", summary: JSON.stringify(final) } });
  if (opts.writeReport !== false) writeReports(final);
  let published: { fingerprint: string } | null = null;
  if (opts.publish) {
    const actor = opts.actor ?? "setup";
    await submitForReview(db, versionId, actor);
    published = await publishVersion(db, versionId, actor);
  }
  return { runId: run.id, skipped: false as const, versionId, rebuild, summary, published: !!published };
}

function writeReports(final: Record<string, unknown>) {
  const dir = path.join(ROOT, "data/reports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "import_report.json"), JSON.stringify(final, null, 1));
  const f = final.final as Awaited<ReturnType<typeof computeInventory>>;
  const s = final.sources as Bank["report"]["sources"];
  const d = final.dedup as Record<string, unknown>;
  const c = final.classification as Record<string, unknown>;
  const lines = [
    `# Import report`,
    ``,
    `Generated: ${final.generated_at}`,
    ``,
    `## Sources`,
    `| Source | Discovered/declared | Extracted | Failed | Missing answer | Missing options | With images |`,
    `|---|---|---|---|---|---|---|`,
    `| PDF (${s.pdf.file}, ${s.pdf.pages} pages) | ${s.pdf.declared_count} | ${s.pdf.extracted} | ${s.pdf.failed} | ${s.pdf.missing_answer} | ${s.pdf.missing_options} | ${s.pdf.with_images} |`,
    `| ExamPrepper (${s.examprepper.captured_pages}/${s.examprepper.expected_pages} pages) | ${s.examprepper.declared_count} | ${s.examprepper.extracted} | ${s.examprepper.failed} | ${s.examprepper.missing_answer} | ${s.examprepper.missing_options} | ${s.examprepper.with_images} |`,
    ``,
    `PDF "(Choose N)" questions printed with too few options/answer letters: ${s.pdf.multi_select_incomplete}. PDF questions referencing an exhibit the PDF lacks: ${s.pdf.references_missing_exhibit}. ExamPrepper multi-select: ${s.examprepper.multi_select}; site answer differs from ExamTopics key: ${s.examprepper.site_vs_examtopics_key_differs}.`,
    ``,
    `Official guide: ${s.guide.domains} domains, ${s.guide.objectives} objectives, ${s.guide.considerations} considerations; weights ${JSON.stringify(s.guide.weights)} (sum ${s.guide.weights_sum}%).`,
    ``,
    `## Deduplication`,
    `- Candidate pairs: ${d.pairs_total} (by stage ${JSON.stringify(d.by_stage)})`,
    `- Duplicate candidates by status: ${JSON.stringify(f.duplicateCandidates)}`,
    `- Confirmed overlap (canonical questions present in both sources): **${f.confirmedOverlap}**`,
    `- Unique canonical questions: **${f.uniqueQuestions}** (PDF ${f.pdfSourceQuestions} + website ${f.websiteSourceQuestions} - overlap ${f.confirmedOverlap}${f.identityHolds ? " ✓" : `; identity adjusted for ${f.intraSourceMerged} intra-source merges`})`,
    `- PDF-only: ${f.pdfOnly}; website-only: ${f.websiteOnly}`,
    ``,
    `## Answers`,
    `- Verification: ${JSON.stringify(f.byVerification)}`,
    `- Multi-select: ${f.multiSelect}; with images: ${f.withImages}`,
    ``,
    `## Classification`,
    `- Source records mapped: ${c.mapped}, unmapped: ${c.unmapped}, low confidence: ${c.low_confidence}`,
    `- Canonical by domain: ${JSON.stringify(f.byDomain)}`,
    `- Alignment bands (source records): ${JSON.stringify(c.alignment_bands)}`,
    `- Concepts without linked questions: ${(c.concepts_without_questions as string[]).length}`,
    ``,
    `## Legacy / outdated`,
    `- Canonical legacy status: ${JSON.stringify(f.byLegacy)}`,
    ``,
    `## Review queue`,
    `- Open review items: ${f.openReviewItems}`,
    ``,
  ];
  fs.writeFileSync(path.join(dir, "import_report.md"), lines.join("\n"));
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const db = new PrismaClient();
  try {
    const res = await importBank(db, arg("--bank"), { versionId: arg("--version"), publish: args.includes("--publish") });
    const fingerprinted = await ensureFingerprints(db);
    console.log(JSON.stringify({ ...res, fingerprinted }, null, 1));
  } finally {
    await db.$disconnect();
  }
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
