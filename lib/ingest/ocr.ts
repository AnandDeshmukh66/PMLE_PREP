import { execFile, spawn } from "node:child_process";
import { IngestError } from "./types";

export type OcrResult = { text: string; confidence: number };
export type OcrEngine = (png: Buffer) => Promise<OcrResult>;

export const tesseractBin = () => process.env.INGEST_TESSERACT || "tesseract";

let available: Promise<boolean> | null = null;
/** Whether the tesseract CLI is installed (checked once per process). */
export function tesseractAvailable(): Promise<boolean> {
  available ??= new Promise((resolve) => execFile(/*turbopackIgnore: true*/ tesseractBin(), ["--version"], { timeout: 5_000 }, (err) => resolve(!err)));
  return available;
}

/** Turns tesseract TSV output into text lines and a mean word confidence (0..1). */
export function parseTesseractTsv(tsv: string): OcrResult {
  const lines = new Map<string, string[]>();
  const confs: number[] = [];
  for (const row of tsv.split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const word = c.slice(11).join("\t").trim();
    const conf = Number(c[10]);
    if (!word) continue;
    const key = `${c[1]}.${c[2]}.${c[3]}.${c[4]}`;
    (lines.get(key) ?? lines.set(key, []).get(key)!).push(word);
    if (conf >= 0) confs.push(conf);
  }
  const text = [...lines.values()].map((w) => w.join(" ")).join("\n");
  const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length / 100 : 0;
  return { text, confidence: Math.round(confidence * 100) / 100 };
}

/** OCR with the local tesseract CLI (free, offline). Output is always treated as low confidence downstream. */
export const tesseractOcr: OcrEngine = async (png) => {
  if (!(await tesseractAvailable())) throw new IngestError("ENGINE_UNAVAILABLE", "OCR needs the tesseract command-line tool, which could not be run on this server. Install Tesseract and set INGEST_TESSERACT to its absolute path, then retry.");
  return new Promise((resolve, reject) => {
    const p = spawn(/*turbopackIgnore: true*/ tesseractBin(), ["stdin", "stdout", "--psm", "4", "tsv"], { stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => reject(new IngestError("EXTRACTOR_CRASHED", "OCR failed to start.")));
    p.on("close", (code) => (code === 0 ? resolve(parseTesseractTsv(out)) : reject(new IngestError("EXTRACTOR_CRASHED", `OCR exited with code ${code}.`))));
    p.stdin.end(png);
  });
};
