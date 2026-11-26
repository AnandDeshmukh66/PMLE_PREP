> **Archived (2026-11-24): this describes a system that no longer exists in the application.** The Data Settings page, Add Certification, uploads, the ingestion pipeline, the job worker and the draft editing screens were removed ([plan](implementation-plans/remove-data-settings-and-exam-ingestion.md)). The `IngestionJob` and `UploadedFile` tables remain in the database, unused and untouched. Content now enters only through the offline import (`scripts/import-db.ts`); see [CURRENT_STATE.md](CURRENT_STATE.md) section 11. Nothing below reflects current behaviour.

# Content ingestion

How question content gets from a PDF, a web page or a JSON file into a certification, and how it reaches learners.

Ingestion never publishes anything. It always writes into a **draft** content version, which an administrator reviews and publishes from the certification's **Data Settings** page (`/c/<code>/data`). Learners only ever see published versions.

## 1. Versions

Each certification has content versions. A version moves through these statuses:

| Status | Who sees it | Editable |
|---|---|---|
| `draft` | Admins only | Yes: ingestion jobs, duplicate decisions, answer resolutions, classification |
| `review` | Admins only | No ingestion; can be returned to draft |
| `published` | Everyone | Never. Corrections go into a new draft. |
| `archived` | Learners can still open it from the version history, with their old progress | Never |

- Publishing is atomic. In one transaction the draft becomes `published` and the previous published version becomes `archived`. If the draft changed after it was submitted for review, publishing is refused.
- A new version starts with fresh progress. Progress on older versions is kept and stays viewable. A question whose text, options or answer changed between versions is never marked as done in the new version.
- Versions and user records are never deleted. The only deletion is of an unpublished draft that has no running jobs, and it is audited.

## 2. Pipeline

```
intake -> extraction -> normalization -> duplicate detection -> objective mapping -> validation -> draft (review required)
```

1. **Intake.** A job is created for an uploaded PDF, a public URL or a manual-import JSON file. Uploaded files are stored by their SHA-256 hash, so re-uploading the same file reuses it. Original files are never modified.
2. **Extraction.** The extraction method depends on the source (section 3). Every extracted question records its provenance: source, page or URL, extraction method, confidence and retrieval time.
3. **Normalization.** Whitespace, option labels and answer letters are cleaned up, and a content hash is computed for each question.
4. **Duplicate detection.** Exact copies, by content hash, are merged automatically. Near-duplicates are found by token similarity and sent to review; they are never merged silently. Questions that differ in numbers or in their answer are kept apart.
5. **Objective mapping.** Questions are matched against the version's exam objectives. Low-confidence matches are flagged for review.
6. **Validation.** A question must have a stem, at least two options and answer letters that exist among its options. Invalid questions are reported, not imported. If the count is below the "Expected #" an admin entered, the job is marked as a partial extraction and retried.
7. **Draft.** Valid questions are written to the draft, and the job ends as `review_required`. A job that produces zero valid questions writes nothing, so an empty draft is never created.

Nothing is invented. Missing answers stay missing, and the question can't be graded until an admin resolves it. Explanations are only stored when the source has them.

## 3. Sources

### PDF (upload or URL)

PyMuPDF reads the text with page references. Image-only (scanned) pages are run through Tesseract OCR when it is installed. OCR questions are low confidence and need review. If a PDF is entirely scanned and Tesseract is missing, the job fails with `ENGINE_UNAVAILABLE` instead of producing an empty draft.

### Website URL

The stages are tried in order, and each one is recorded on the job:

1. **Direct HTTP fetch** of the page, parsed as HTML.
2. **Headless browser** (Playwright Chromium, with no cookies or stored logins). This runs only if stage 1 found no questions, for example on pages rendered by JavaScript.
3. **Screenshot OCR** of the rendered page. This is a last resort: confidence is capped at 0.6, and every question is flagged for review.

**Access policy.** These stops are final and are never worked around:

- `robots.txt` is fetched and obeyed for the `CertPrepIngest` user agent, including `Crawl-delay`. A `Disallow` stops the job with `ROBOTS_DISALLOWED`.
- Login pages, paywalls, HTTP 401/402/403 and CAPTCHA or bot-check pages stop the job (`ACCESS_DENIED`, `CHALLENGE_PAGE`). The app never signs in, solves challenges or uses stored credentials.
- Only public `http(s)` URLs are accepted. Private, loopback and link-local addresses are refused, including after redirects and for browser sub-requests (`UNSAFE_URL`).
- Requests are rate-limited, honour `Retry-After` (capped at 30 s), time out after 20 s, and are limited to 15 MB.

The admin who adds a source is responsible for checking that the site's terms allow this use. When a site can't be ingested automatically, download content you are allowed to use and use **Manual import**.

### Manual import (JSON)

Upload a `.json` file in this format from Data Settings, or when adding a certification:

```json
{
  "format": "cert-prep-questions/v1",
  "source": { "name": "Team-written practice set", "url": null, "retrievedAt": "2026-11-05" },
  "questions": [
    {
      "number": 1,
      "id": "optional-source-id",
      "stem": "Question text",
      "options": [{ "label": "A", "text": "First option" }, { "label": "B", "text": "Second option" }],
      "answer": ["B"],
      "explanation": "Optional, only if the source has one",
      "page": null,
      "url": null
    }
  ]
}
```

Each question needs 2 to 12 options with single-letter labels. `answer` may be empty, in which case the question is ungradable until it is resolved. A file can hold up to 5,000 questions.

## 4. Jobs, retries and the worker

Jobs are stored in the database (`IngestionJob`, with a log of every stage attempted, its warnings and its counts), so they survive restarts. By default a job gets 3 attempts.

| Status | Meaning |
|---|---|
| `pending` | Added to the draft (file stored or URL recorded) but not processed; shown as "Waiting to start" |
| `queued` | **Start processing** was clicked, or a retry is scheduled for `nextRunAt` |
| `processing` | Claimed by a worker under a 30-minute lease |
| `review_required` | Questions were written to the draft; an admin must review them |
| `published` | The draft was published |
| `failed` | It stopped with an error code (below); an admin can retry it |
| `cancelled` / `removed` | Cancelled before it ran, or its source was removed from the draft (its questions were removed too) |

- **Retryable errors** are re-queued automatically with exponential backoff, up to the job's maximum number of attempts: `TIMEOUT`, `RATE_LIMITED`, `HTTP_SERVER_ERROR`, `NETWORK`, `EXTRACTOR_CRASHED` and `PARTIAL_EXTRACTION`.
- **Permanent errors** fail straight away: `ROBOTS_DISALLOWED`, `ACCESS_DENIED`, `CHALLENGE_PAGE`, `NOT_FOUND`, `HTTP_CLIENT_ERROR`, `UNSAFE_URL`, `UNSUPPORTED_FORMAT`, `TOO_LARGE`, `NO_QUESTIONS`, `INVALID_FILE`, `ENGINE_UNAVAILABLE`, `VERSION_LOCKED` and `CANCELLED`. The Data Settings page shows a plain-language explanation for each.
- Retries are safe. A job replaces only its own questions in the draft, and claiming a job is atomic, so two workers never process the same job. A crashed worker's lease expires and the job is picked up again.

**Running jobs.** Uploading a PDF or adding a website only adds the source (status `pending`); the same file or URL added twice is reused, not duplicated. Nothing is extracted until an admin clicks **Start processing** in the draft, which queues every waiting source of that draft (and brings scheduled retries forward) and reports how many it started. The web app then processes them in the background after the response, one at a time per draft, and the page refreshes as each finishes; a draft with pending sources cannot be published. **Retry** on a failed source re-runs that job in place. Manually edited questions are kept when a source is re-processed. For scheduled retries without anyone on the page, run the worker:

```bash
npm run ingest:worker            # keeps polling every 15 s; stop with Ctrl+C
npm run ingest:worker -- --once  # processes what is due, then exits (for cron)
```

Set `INGEST_INLINE=off` if only the worker should process jobs, for example on serverless hosts where background work after a response is cut short.

## 5. Server requirements

All of these are free, and each is optional. Without one, the matching source type fails with `ENGINE_UNAVAILABLE`; nothing is silently skipped.

| Need | For | Setting |
|---|---|---|
| Python 3 with PyMuPDF (`pip install -r requirements.txt`) | PDFs | `INGEST_PYTHON` (default `python3`) |
| Tesseract OCR | Scanned PDF pages, screenshot OCR | `INGEST_TESSERACT` (default `tesseract`) |
| The `playwright` package and `npx playwright install chromium` | JavaScript-rendered pages | `INGEST_BROWSER=off` disables this stage |

Playwright comes with the dev dependencies. A production install with `--omit=dev` doesn't include it, so the browser stage then reports `ENGINE_UNAVAILABLE`.

## 6. What has been tested

The ingestion tests are in `tests/unit/ingest*.test.ts` and `tests/integration/certifications.test.ts`:

- **Real PyMuPDF:** generated PDFs, including image-only pages and corrupt files.
- **Websites:** an in-process fake site covering success, JavaScript-only pages, OCR fallback, 403, login and challenge pages, 404, `robots.txt` disallow, timeouts, 429 with recovery, layout changes, partial extraction, unsupported formats and unsafe redirects.

The website tests don't contact real sites, and OCR is tested with a stubbed Tesseract because Tesseract wasn't installed on the development machine. Real-site extraction hasn't been verified against any particular website.
