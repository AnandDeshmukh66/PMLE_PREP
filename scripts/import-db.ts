/**
 * Idempotent DB import: data/processed/bank.json -> SQLite.
 * Upserts content tables only. User activity (attempts, flags, notes, sessions, theory
 * progress, settings) is never deleted; user duplicate decisions and issue resolutions are kept.
 *
 *   npx tsx scripts/import-db.ts [--bank path] [--db file:../data/x.db]
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { rebuildCanonicals } from "../lib/canonicalize";
import { computeInventory } from "../lib/inventory";
import { parseJson } from "../lib/json";

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

const ISSUE_TEXT: Record<string, [string, string]> = {
  multi_select_incomplete: ["warning", "The PDF lists fewer options or answer letters than this '(Choose N)' question requires; the website version is used as canonical."],
  references_missing_exhibit: ["warning", "Question text refers to an exhibit or diagram that the PDF does not include."],
  image_unresolved: ["error", "An exhibit image could not be downloaded."],
  missing_answer: ["error", "No answer key was found for this source question."],
  missing_options: ["error", "Fewer than two answer options were extracted."],
  answer_not_in_options: ["error", "The answer key references an option letter that does not exist."],
  short_stem: ["warning", "The question stem is unusually short; check the extraction."],
};

export async function importBank(db: PrismaClient, bankPath = path.join(ROOT, "data/processed/bank.json"), opts: { writeReport?: boolean } = {}) {
  const bank: Bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
  const run = await db.importRun.create({ data: {} });

  await db.$transaction(
    async (tx) => {
      const rep = bank.report.sources;
      await tx.questionSource.upsert({
        where: { id: "pdf" },
        create: { id: "pdf", name: "PDF question bank", kind: "pdf", fileName: String(rep.pdf.file), declaredCount: Number(rep.pdf.declared_count) || null, extractedCount: Number(rep.pdf.extracted) },
        update: { fileName: String(rep.pdf.file), declaredCount: Number(rep.pdf.declared_count) || null, extractedCount: Number(rep.pdf.extracted) },
      });
      await tx.questionSource.upsert({
        where: { id: "examprepper" },
        create: { id: "examprepper", name: "ExamPrepper", kind: "website", url: String(rep.examprepper.url), declaredCount: Number(rep.examprepper.declared_count) || null, extractedCount: Number(rep.examprepper.extracted) },
        update: { url: String(rep.examprepper.url), declaredCount: Number(rep.examprepper.declared_count) || null, extractedCount: Number(rep.examprepper.extracted) },
      });

      let order = 0;
      for (const d of bank.taxonomy.domains) {
        await tx.examDomain.upsert({ where: { number: d.number }, create: { number: d.number, title: d.title, weightPercent: d.weight_percent }, update: { title: d.title, weightPercent: d.weight_percent } });
        for (const o of d.objectives) {
          const data = { domainNumber: d.number, title: o.title, considerations: JSON.stringify(o.considerations), order: order++ };
          await tx.examObjective.upsert({ where: { code: o.code }, create: { code: o.code, ...data }, update: data });
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
        await tx.theoryConcept.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
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
        await tx.sourceOccurrence.upsert({ where: { sourceKey: s.source_key }, create: { sourceKey: s.source_key, ...data }, update: data });
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
        const existing = await tx.duplicateCandidate.findUnique({ where: { pairKey } });
        if (!existing) {
          await tx.duplicateCandidate.create({ data: { pairKey, ...metrics, status: p.decision } });
        } else {
          const userDecided = existing.status === "approved" || existing.status === "rejected";
          await tx.duplicateCandidate.update({ where: { pairKey }, data: { ...metrics, ...(userDecided ? {} : { status: p.decision }) } });
        }
      }
    },
    { timeout: 300_000, maxWait: 20_000 },
  );

  const rebuild = await rebuildCanonicals(db);

  // ---- review queue (issues keep their user status across imports)
  const occs = await db.sourceOccurrence.findMany({ select: { sourceKey: true, canonicalId: true, issues: true } });
  const canon = await db.canonicalQuestion.findMany({ where: { active: true } });
  const pending = await db.duplicateCandidate.findMany({ where: { status: "pending" } });
  const issues: { issueKey: string; sourceKey?: string; questionId?: number | null; kind: string; severity: string; message: string }[] = [];
  for (const o of occs) {
    for (const kind of parseJson<string[]>(o.issues, [])) {
      const [severity, message] = ISSUE_TEXT[kind] ?? ["warning", kind];
      issues.push({ issueKey: `${o.sourceKey}:${kind}`, sourceKey: o.sourceKey, questionId: o.canonicalId, kind, severity, message });
    }
  }
  for (const c of canon) {
    if (c.verification === "conflict") issues.push({ issueKey: `${c.code}:answer_conflict`, questionId: c.id, kind: "answer_conflict", severity: "warning", message: c.verificationNote ?? "Sources disagree on the answer." });
    if (c.verification === "contested") issues.push({ issueKey: `${c.code}:answer_contested`, questionId: c.id, kind: "answer_contested", severity: "info", message: c.verificationNote ?? "Answer is contested." });
    if (c.verification === "unknown") issues.push({ issueKey: `${c.code}:missing_answer`, questionId: c.id, kind: "missing_answer", severity: "error", message: "No answer key from any source." });
    if (c.classificationStatus === "unmapped") issues.push({ issueKey: `${c.code}:unmapped`, questionId: c.id, kind: "classification_unmapped", severity: "warning", message: "No exam objective could be matched automatically." });
    else if (c.classificationConfidence === "low") issues.push({ issueKey: `${c.code}:low_confidence`, questionId: c.id, kind: "classification_low_confidence", severity: "info", message: `Low classification confidence. ${c.classificationExplanation}` });
    if (c.legacyStatus === "deprecated_feature" || c.legacyStatus === "possibly_outdated") {
      const notes = parseJson<{ term: string; modern: string }[]>(c.legacyNotes, []);
      issues.push({ issueKey: `${c.code}:legacy`, questionId: c.id, kind: "legacy_needs_verification", severity: "info", message: notes.map((n) => `${n.term}: ${n.modern}`).join(" ") });
    }
  }
  for (const p of pending) issues.push({ issueKey: `dup:${p.pairKey}`, kind: "duplicate_pending", severity: "warning", message: `${p.aKey} and ${p.bKey}: ${p.reason}` });
  const missingPages = (bank.report.sources.examprepper.missing_pages as number[]) ?? [];
  if (missingPages.length) issues.push({ issueKey: "examprepper:missing_pages", kind: "missing_pages", severity: "error", message: `ExamPrepper pages not captured: ${missingPages.join(", ")}` });

  const seen = new Set(issues.map((i) => i.issueKey));
  await db.$transaction(
    async (tx) => {
      for (const i of issues) {
        await tx.importIssue.upsert({
          where: { issueKey: i.issueKey },
          create: { ...i, questionId: i.questionId ?? null, lastRunId: run.id, active: true },
          update: { kind: i.kind, severity: i.severity, message: i.message, questionId: i.questionId ?? null, sourceKey: i.sourceKey ?? null, lastRunId: run.id, active: true },
        });
      }
      const stale = await tx.importIssue.findMany({ where: { active: true }, select: { issueKey: true } });
      for (const s of stale) if (!seen.has(s.issueKey)) await tx.importIssue.update({ where: { issueKey: s.issueKey }, data: { active: false } });
    },
    { timeout: 120_000 },
  );

  const summary = await computeInventory(db);
  const final = { ...bank.report, final: summary, rebuild, import_run: run.id };
  await db.importRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), status: "succeeded", summary: JSON.stringify(final) } });
  if (opts.writeReport !== false) writeReports(final);
  return { runId: run.id, rebuild, summary };
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
  const bankIdx = args.indexOf("--bank");
  const db = new PrismaClient();
  try {
    const res = await importBank(db, bankIdx >= 0 ? args[bankIdx + 1] : undefined);
    console.log(JSON.stringify(res, null, 1));
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
