import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tesseractBin } from "./ocr";
import { IngestError, type PageText } from "./types";

export type PdfPages = { pageCount: number; pages: PageText[]; warnings: string[]; scannedPages: number[]; ocrAvailable: boolean };
export type PdfEngine = (bytes: Buffer) => Promise<PdfPages>;

export const isPdf = (bytes: Buffer) => bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"));

const SCRIPT = path.join(process.cwd(), "scripts/ingest/pdf_extract.py");

/**
 * Runs the PyMuPDF extractor on a private temporary copy of the bytes (uploads are never written next to the
 * original source files). Python comes from INGEST_PYTHON, defaulting to `python3`.
 */
export const pymupdfEngine: PdfEngine = async (bytes) => {
  if (!isPdf(bytes)) throw new IngestError("INVALID_FILE", "The file is not a PDF.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ingest-"));
  const file = path.join(dir, `${crypto.randomBytes(8).toString("hex")}.pdf`);
  await fs.writeFile(file, bytes, { mode: 0o600 });
  try {
    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn(/*turbopackIgnore: true*/ process.env.INGEST_PYTHON || "python3", [SCRIPT, file, "--tesseract", tesseractBin()], { stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000 });
      let stdout = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", () => undefined);
      p.on("error", () => reject(new IngestError("ENGINE_UNAVAILABLE", `Python could not be started for PDF extraction. Set INGEST_PYTHON to the absolute path of a Python 3 interpreter with PyMuPDF installed${process.env.INGEST_PYTHON ? " (the configured path could not be run)" : " (it is not set, so python3 from PATH was tried)"}, then retry.`)));
      p.on("close", (code, signal) => (code === 0 ? resolve(stdout) : reject(new IngestError(signal ? "TIMEOUT" : "EXTRACTOR_CRASHED", signal ? "PDF extraction took too long." : `The PDF extractor exited with code ${code}.`))));
    });
    let parsed: { error?: string; message?: string; page_count?: number; pages?: PageText[]; warnings?: string[]; scanned_pages?: number[]; ocr_available?: boolean };
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new IngestError("EXTRACTOR_CRASHED", "The PDF extractor returned unreadable output.");
    }
    if (parsed.error) throw new IngestError(parsed.error === "ENGINE_UNAVAILABLE" ? "ENGINE_UNAVAILABLE" : "INVALID_FILE", parsed.message);
    return { pageCount: parsed.page_count ?? 0, pages: parsed.pages ?? [], warnings: parsed.warnings ?? [], scannedPages: parsed.scanned_pages ?? [], ocrAvailable: !!parsed.ocr_available };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};
