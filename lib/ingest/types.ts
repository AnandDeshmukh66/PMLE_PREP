import { z } from "zod";

export const EXTRACTION_METHODS = ["pdf_text", "pdf_ocr", "html", "rendered_html", "screenshot_ocr", "json"] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

/** One question exactly as a source presents it, with provenance. The canonical interchange format of every adapter. */
export const ExtractedQuestion = z.object({
  qnum: z.number().int().min(1).max(100_000),
  sourceRef: z.string().max(120).nullish(),
  stem: z.string().min(1).max(20_000),
  options: z.array(z.object({ label: z.string().regex(/^[A-Z]$/), text: z.string().max(5_000) })).max(12),
  answer: z.array(z.string().regex(/^[A-Z]$/)).max(12).default([]),
  explanation: z.string().max(20_000).nullish(),
  page: z.number().int().min(1).nullish(),
  pageEnd: z.number().int().min(1).nullish(),
  url: z.string().max(2_000).nullish(),
  method: z.enum(EXTRACTION_METHODS),
  confidence: z.number().min(0).max(1),
  issues: z.array(z.string().max(60)).max(20).default([]),
  rawText: z.string().max(40_000).nullish(),
});
export type ExtractedQuestion = z.infer<typeof ExtractedQuestion>;

/** Manual-import file: what an administrator uploads when automatic extraction is not possible or not permitted. */
export const ManualImportFile = z.object({
  format: z.literal("cert-prep-questions/v1"),
  source: z.object({ name: z.string().min(1).max(120), url: z.string().max(2_000).nullish(), retrievedAt: z.string().max(40).nullish() }).optional(),
  questions: z
    .array(
      z.object({
        number: z.number().int().min(1).max(100_000),
        id: z.string().max(120).nullish(),
        stem: z.string().min(1).max(20_000),
        options: z.array(z.object({ label: z.string().regex(/^[A-Za-z]$/), text: z.string().min(1).max(5_000) })).min(2).max(12),
        answer: z.array(z.string().regex(/^[A-Za-z]$/)).max(12).default([]),
        explanation: z.string().max(20_000).nullish(),
        page: z.number().int().min(1).nullish(),
        url: z.string().max(2_000).nullish(),
      }),
    )
    .min(1)
    .max(5_000),
});

export type StageStatus = "succeeded" | "failed" | "skipped";
export type StageRecord = {
  stage: string;
  method: string;
  status: StageStatus;
  startedAt: string;
  finishedAt: string;
  extracted?: number;
  valid?: number;
  detail?: string;
  errorCode?: string;
};

/**
 * Failure codes. `retryable` failures (timeouts, rate limits, 5xx, a crashed extractor) are retried with backoff;
 * the rest need a person (permission, login wall, wrong format, a layout the parser does not understand).
 */
export const INGEST_ERRORS = {
  TIMEOUT: { retryable: true, help: "The source did not respond in time. The job is retried automatically." },
  RATE_LIMITED: { retryable: true, help: "The site asked us to slow down (HTTP 429). The job is retried later with backoff." },
  HTTP_SERVER_ERROR: { retryable: true, help: "The site returned a server error. The job is retried automatically." },
  NETWORK: { retryable: true, help: "The site could not be reached. Check the URL; the job is retried automatically." },
  EXTRACTOR_CRASHED: { retryable: true, help: "The extractor stopped unexpectedly. The job is retried automatically." },
  PARTIAL_EXTRACTION: { retryable: true, help: "Fewer questions than expected were extracted; retrying." },
  ROBOTS_DISALLOWED: { retryable: false, help: "The site's robots.txt does not allow automated access to this page. Download the content manually (if its terms allow it) and use Manual import." },
  ACCESS_DENIED: { retryable: false, help: "The page requires sign-in, payment or is forbidden. Automated access is not attempted; use Manual import with content you are allowed to use." },
  CHALLENGE_PAGE: { retryable: false, help: "The site showed a CAPTCHA or bot check. It is never bypassed; use Manual import instead." },
  NOT_FOUND: { retryable: false, help: "The page does not exist (HTTP 404). Check the URL." },
  HTTP_CLIENT_ERROR: { retryable: false, help: "The site rejected the request. Check the URL." },
  UNSAFE_URL: { retryable: false, help: "Only public http(s) URLs are allowed." },
  UNSUPPORTED_FORMAT: { retryable: false, help: "This content type is not supported. Upload a PDF, or use Manual import (JSON)." },
  TOO_LARGE: { retryable: false, help: "The content is larger than the ingestion limit." },
  NO_QUESTIONS: { retryable: false, help: "No questions could be recognised. The layout may have changed or the content is not a question bank. Nothing was written to the draft; use Manual import." },
  INVALID_FILE: { retryable: false, help: "The uploaded file is not a valid PDF or manual-import JSON file." },
  ENGINE_UNAVAILABLE: { retryable: false, help: "A required extraction tool is not available on the server (PDF: INGEST_PYTHON with PyMuPDF; scanned pages: INGEST_TESSERACT). An administrator fixes the server setting, then retries." },
  VERSION_LOCKED: { retryable: false, help: "The target version is no longer a draft. Create a new draft and run the job again." },
  CANCELLED: { retryable: false, help: "The job was cancelled." },
} as const;
export type IngestErrorCode = keyof typeof INGEST_ERRORS;

export class IngestError extends Error {
  constructor(
    public code: IngestErrorCode,
    message?: string,
    public retryAfterMs?: number,
  ) {
    super(message ?? INGEST_ERRORS[code].help);
  }
  get retryable() {
    return INGEST_ERRORS[this.code].retryable;
  }
}

export type PageText = { page: number; text: string; method: ExtractionMethod; confidence: number };
