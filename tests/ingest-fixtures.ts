import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FetchImpl } from "@/lib/ingest/fetcher";

/** Synthetic practice questions (test fixtures only; not real exam content). */
const TOPICS = [
  ["streaming sensor readings", "a managed stream processing pipeline", "a nightly spreadsheet export"],
  ["a churn prediction model", "SQL-based training inside the warehouse", "manual labelling on a laptop"],
  ["image classification at scale", "transfer learning from a pretrained network", "training a network from random weights"],
  ["feature drift in production", "scheduled skew and drift monitoring", "redeploying the model every hour"],
  ["a recommendation service", "an approximate nearest neighbour index", "a full table scan per request"],
  ["sensitive customer records", "de-identification before training", "copying raw records to a public bucket"],
  ["hyperparameter search", "a managed tuning service with early stopping", "editing values by hand after each run"],
  ["batch scoring of invoices", "a scheduled batch prediction job", "an always-on GPU endpoint"],
  ["tabular fraud detection", "gradient boosted trees with class weighting", "a rule that flags every transaction"],
  ["pipeline reproducibility", "versioned pipeline components with lineage", "undocumented notebooks"],
  ["low-latency online features", "an online feature store", "recomputing features from raw logs per request"],
  ["model explainability for auditors", "feature attributions recorded per prediction", "deleting prediction logs"],
];

export type FixtureQ = { n: number; stem: string; options: string[]; answer: string; explanation: string };

export function fixtureQuestions(count = TOPICS.length, offset = 0): FixtureQ[] {
  return Array.from({ length: count }, (_, i) => {
    const [topic, good, bad] = TOPICS[(i + offset) % TOPICS.length];
    const n = i + 1;
    return {
      n,
      stem: `Fixture scenario ${n + offset}: a team is working on ${topic} and wants the most maintainable approach with the least operational effort. What should they do?`,
      options: [`Use ${good}.`, `Use ${bad}.`, `Wait for case ${n + offset} to resolve itself.`, `Hire contractors to do case ${n + offset} manually.`],
      answer: "A",
      explanation: `${good} fits the requirement.`,
    };
  });
}

export const asText = (qs: FixtureQ[]) =>
  qs.map((q) => [`Question ${q.n}`, q.stem, ...q.options.map((o, i) => `${"ABCD"[i]}. ${o}`), `Answer: ${q.answer}`, `Explanation: ${q.explanation}`].join("\n")).join("\n\n");

export const asHtml = (qs: FixtureQ[], opts: { letters?: boolean; title?: string } = {}) =>
  `<!doctype html><html><head><title>${opts.title ?? "Practice set"}</title><style>.q{margin:1em}</style></head><body><nav>Home | About</nav>` +
  qs
    .map(
      (q) =>
        `<div class="q"><h3>Question ${q.n}</h3><p>${q.stem}</p><ul>${q.options.map((o, i) => `<li>${opts.letters === false ? "" : `${"ABCD"[i]}. `}${o}</li>`).join("")}</ul>` +
        (opts.letters === false ? "" : `<p>Answer: ${q.answer}</p>`) +
        `</div>`,
    )
    .join("") +
  `<footer>&copy; Fixture site</footer></body></html>`;

export const JS_SHELL = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`;

type Reply = { status?: number; body?: string | Buffer; type?: string; headers?: Record<string, string> } | "timeout" | "network";

/** In-memory website for the fetcher: routes map a path to one reply or a sequence (the last one repeats). */
export function fakeSite(routes: Record<string, Reply | Reply[]>) {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const fetchImpl: FetchImpl = async (url) => {
    const u = new URL(url);
    const key = u.pathname + u.search;
    calls.push(key);
    const r = routes[key] ?? routes[u.pathname];
    if (r === undefined) return new Response("not found", { status: 404 });
    const list = Array.isArray(r) ? r : [r];
    const i = counts.get(key) ?? 0;
    counts.set(key, i + 1);
    const reply = list[Math.min(i, list.length - 1)];
    if (reply === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
    if (reply === "network") throw new TypeError("fetch failed");
    const body = typeof reply.body === "string" ? reply.body : reply.body ? new Uint8Array(reply.body) : "";
    return new Response(body, { status: reply.status ?? 200, headers: { "content-type": reply.type ?? "text/html; charset=utf-8", ...reply.headers } });
  };
  return { fetchImpl, calls };
}

export const noSleep = async () => {};

/** A Python with PyMuPDF, or null (the PDF tests are then skipped with a visible reason). */
export function pythonWithPymupdf(): string | null {
  const candidates = [process.env.INGEST_PYTHON, path.resolve(".venv/bin/python"), path.resolve("../.venv/bin/python"), "python3"].filter(Boolean) as string[];
  for (const py of candidates) {
    try {
      execFileSync(py, ["-c", "import pymupdf"], { stdio: "ignore" });
      return py;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Builds a PDF with PyMuPDF: one text page per entry; null entries become image-only (scanned) pages. */
export function makePdf(py: string, pages: (string | null)[]): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "certprep-pdf-"));
  const spec = path.join(dir, "pages.json");
  const out = path.join(dir, "out.pdf");
  fs.writeFileSync(spec, JSON.stringify(pages));
  const code = `
import json, sys, pymupdf
pages = json.load(open(sys.argv[1]))
doc = pymupdf.open()
for text in pages:
    page = doc.new_page(width=612, height=792)
    if text is None:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 200), False)
        pix.set_rect(pix.irect, (240, 240, 240))
        page.insert_image(pymupdf.Rect(50, 50, 550, 550), pixmap=pix)
    else:
        for size in (9, 8, 7, 6, 5):
            if page.insert_textbox(pymupdf.Rect(30, 30, 582, 762), text, fontsize=size) >= 0:
                break
        else:
            raise SystemExit("fixture text does not fit on one page")
doc.save(sys.argv[2])
`;
  try {
    execFileSync(py, ["-c", code, spec, out]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
