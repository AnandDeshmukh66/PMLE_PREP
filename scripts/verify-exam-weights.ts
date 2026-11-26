/**
 * Read-only check that a certification's stored exam-domain weights equal the official exam guide (release gate for
 * Blueprint Distribution Alignment). It never writes: the database is read with findUnique/findMany only.
 *
 *   npx tsx scripts/verify-exam-weights.ts [--guide <pdf>] [--live [--guide-url <url>]] [--cert pmle] [--sections 6]
 *
 * Prints the guide's SHA-256 (and the live copy's with --live; the download goes to a temporary directory outside the
 * repository and is deleted), a comparison table, and on a pass the BLUEPRINT_VERIFIED_WEIGHTS entry to configure.
 * Exits 1 on any mismatch, 2 when the check cannot run. The database is the one in DATABASE_URL.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { compareGuideWeights, type GuideSection, parseGuideWeights } from "../lib/blueprint";

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_GUIDE = path.join(ROOT, "data/raw/guide/pmle_exam_guide_2026-06-01.pdf");
const DEFAULT_URL = "https://services.google.com/fh/files/misc/professional_machine_learning_engineer_exam_guide_english_new.pdf";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sha256 = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

function python(): string {
  if (process.env.INGEST_PYTHON) return process.env.INGEST_PYTHON;
  const venv = path.resolve(ROOT, "../.venv/bin/python");
  return fs.existsSync(venv) ? venv : "python3";
}

/** Guide sections from a PDF, extracted with the PyMuPDF script scripts/pdf_extract.py. */
function guideSections(file: string): GuideSection[] {
  const r = spawnSync(python(), [path.join(ROOT, "scripts/pdf_extract.py"), file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`pdf_extract.py failed (${r.status}): ${r.stderr.slice(0, 300)}`);
  const out = JSON.parse(r.stdout) as { error?: string; message?: string; pages?: { text: string }[] };
  if (out.error) throw new Error(`${out.error}: ${out.message ?? ""}`);
  return parseGuideWeights((out.pages ?? []).map((p) => p.text).join("\n"));
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function provider(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) return `SQLite (${path.basename(url.slice(5))})`;
  if (/^postgres(ql)?:/.test(url)) {
    const host = /@([^/:?]+)/.exec(url)?.[1] ?? "?";
    return `PostgreSQL (host ${host.replace(/^([^.]{0,6})[^.]*/, "$1…")})`;
  }
  return "unknown";
}

async function main() {
  const guide = path.resolve(arg("guide") ?? DEFAULT_GUIDE);
  const slug = arg("cert") ?? "pmle";
  const expected = arg("sections") ? Number(arg("sections")) : slug === "pmle" ? 6 : undefined;
  const bytes = fs.readFileSync(guide);
  const storedHash = sha256(bytes);
  const official = guideSections(guide);
  console.log(`Guide:        ${path.relative(ROOT, guide)}\nSHA-256:      ${storedHash}`);

  let liveOk: boolean | null = null;
  if (process.argv.includes("--live")) {
    const url = arg("guide-url") ?? DEFAULT_URL;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guide-"));
    try {
      const live = await download(url);
      const liveHash = sha256(live);
      console.log(`Live guide:   ${url}\nLive SHA-256: ${liveHash}${liveHash === storedHash ? " (identical to the stored copy)" : " (differs from the stored copy)"}`);
      if (liveHash === storedHash) liveOk = true;
      else {
        const file = path.join(dir, "live.pdf");
        fs.writeFileSync(file, live, { mode: 0o600 });
        const liveSections = guideSections(file);
        const same = compareGuideWeights(liveSections, official.map((s) => ({ number: s.number, title: s.title, weightPercent: s.weight })), expected);
        liveOk = same.pass;
        console.log(same.pass ? "Live guide weights and titles equal the stored copy's." : `The official guide has been revised:\n  ${same.problems.join("\n  ")}`);
      }
    } catch (e) {
      console.log(`Live guide could not be fetched (${e instanceof Error ? e.message : e}). A person must confirm the six values on the official guide page.`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const db = new PrismaClient();
  try {
    const cert = await db.certification.findUnique({ where: { slug }, select: { id: true, code: true, currentVersionId: true } });
    if (!cert?.currentVersionId) {
      console.error(`No published version for certification "${slug}".`);
      process.exitCode = 2;
      return;
    }
    const domains = await db.examDomain.findMany({ where: { versionId: cert.currentVersionId }, orderBy: { number: "asc" }, select: { number: true, title: true, weightPercent: true } });
    const cmp = compareGuideWeights(official, domains, expected);
    console.log(`Database:     ${provider()}\nVersion:      ${cert.currentVersionId} (${cert.code}, published)\n`);
    console.log("Domain | Guide | Stored | Weight | Title");
    for (const r of cmp.rows) console.log(`${String(r.number).padEnd(6)} | ${String(r.official ?? "-").padStart(4)}% | ${String(r.stored ?? "-").padStart(5)}% | ${r.weightOk ? "ok    " : "DIFFER"} | ${r.titleOk ? "ok" : `DIFFER: "${r.officialTitle}" vs "${r.storedTitle}"`}`);
    console.log(`Totals: guide ${cmp.officialSum}%, stored ${cmp.storedSum}% (as published; scaled only in memory)\n`);
    if (liveOk === false) cmp.problems.push("The live official guide differs from the stored copy.");
    if (cmp.problems.length) {
      console.log(`RESULT: MISMATCH. Do not set BLUEPRINT_VERIFIED_WEIGHTS and do not change any record.\n  ${cmp.problems.join("\n  ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`RESULT: PASS${liveOk ? "" : " (stored guide only: confirm the live guide by eye before configuring)"}.`);
    console.log(`BLUEPRINT_VERIFIED_WEIGHTS entry: ${cert.currentVersionId}=${domains.map((d) => d.weightPercent).join(",")}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
