# Current state

Audit baseline: **2026-11-20**, updated **2026-11-21** for the Questions & Review consolidation and Exam Coverage & Quality ([plan](implementation-plans/exam-guide-mapping.md)). Describes the application as it exists in the working tree. Test and live-data figures come from the last verification run (**2026-11-05**) and are labelled as such. See [README.md](README.md) for how this file is maintained and [architecture/](architecture/) for structure details.

Status labels: **Working** (implemented and exercised by tests or manual runs), **Partial** (implemented with stated gaps), **Unverified** (code exists, not exercised), **Missing** (not implemented).

## 1. Overview

PMLE Prep is an internal study portal for professional-certification exam practice. It started as a single-certification (Google Cloud Professional Machine Learning Engineer, "PMLE") question-bank viewer and now supports multiple certifications, each with immutable, versioned content. Learners practise questions, take timed mock exams, track theory coverage and progress; administrators import questions (PDF, website, JSON), review data quality and publish new content versions.

- Sign-in is by company email only (no password). See section 6.
- Content shipped: PMLE 2026, bootstrapped from a local PDF and an ExamPrepper capture (339 canonical questions, 149 theory concepts, mapped to the June 2026 exam guide). Professional Data Engineer (PDE) exists as a certification record with **no published content** on the production database; test/demo drafts for it were created only in a separate `demo_e2e` schema.
- Source repository: a single commit exists (`5183c75`); essentially all multi-user and multi-certification work is **uncommitted** in the working tree (`git status --short` lists 116 entries on 2026-11-20, including untracked directories).

## 2. Technology stack

| Area | Technology (from `package.json`) |
|---|---|
| Framework | Next.js 16.4.3 (App Router, Turbopack), React 19.2, TypeScript 5. `AGENTS.md` warns this Next.js version has breaking changes; read `node_modules/next/dist/docs/` before changing framework-level code. |
| UI | Tailwind CSS 4, `lucide-react`, `recharts`, `clsx`, `tailwind-merge`. No component library; primitives are in `components/ui.tsx`. |
| Data | Prisma 6.19.3. SQLite for local development, PostgreSQL (Neon) for production, chosen by `DATABASE_URL` prefix via `scripts/db.mjs`. |
| Validation | Zod 4 (server action/route inputs, settings, backup format, ingestion formats). |
| Python tooling | PyMuPDF (PDF text), RapidFuzz, numpy, scikit-learn, requests (`requirements.txt`) for the PMLE bootstrap pipeline; PyMuPDF only for the in-app PDF adapter (`scripts/ingest/pdf_extract.py`). |
| Optional binaries | Tesseract (OCR of scanned PDFs and screenshots); Playwright Chromium (rendering JS-heavy pages). |
| Testing | Vitest 3 (unit + integration), Playwright (e2e), PGlite (`@electric-sql/pglite*`, in-process PostgreSQL for tests). |
| Neon packages | `@neon/config`, `@neon/env` are dependencies and `neon.ts` exists, but **no application code imports them** (grep of `app/`, `lib/`, `components/`, `scripts/`, `tests/`). Treat as CLI scaffolding. |

## 3. Application structure

```
app/
  layout.tsx, globals.css, global-error.tsx
  login/page.tsx                      public sign-in page
  (portal)/                           authenticated area (layout wraps SyncProvider)
    (home)/page.tsx                   certification home
    (home)/settings/page.tsx          preferences, backup, admin unlock
    (home)/certifications/new/page.tsx  add certification (admin)
    c/[cert]/...                      all study + admin pages for one certification
  api/                                route handlers (section 5)
components/                           client + shared UI (autosave, runners, editors, sidebar)
lib/                                  business logic, server actions, auth, data access
lib/ingest/                           ingestion adapters, pipeline, jobs, worker
prisma/                               schema.prisma (SQLite, source of truth), postgres/ (generated schema + own migrations), migrations/
scripts/                              db.mjs, import-db.ts, ingest-worker.ts, backup, copy and claim scripts, Python pipeline
tests/                                unit, integration, e2e
data/                                 SQLite DB, backups, raw/processed PMLE source data, taxonomy (mostly gitignored)
docs/                                 documentation
proxy.ts, instrumentation.ts          request gate; boot-time backup scheduler
```

## 4. Frontend architecture and navigation

- **Rendering.** Server Components fetch data directly with Prisma (no REST layer for pages). Interactive parts are client components in `components/`. All portal routes are dynamic (`ƒ` in the build output).
- **Layouts.** `app/(portal)/layout.tsx` calls `requireUser()` and mounts `SyncProvider` (client autosave outbox). `app/(portal)/c/[cert]/layout.tsx` calls `certAdminPage()`, loads sidebar counts and renders `AppShell` + `Sidebar`; `(home)/layout.tsx` renders the shell without certification context.
- **Certification routing.** Every study page lives under `/c/<slug>/…` (`lib/cert-rules.ts: certBase`). Pre-multi-certification URLs (`/questions`, `/practice`, `/mock`, `/theory`, `/plan`, `/analytics`, `/blueprint`, `/review`, `/flagged`, `/incorrect`, `/bookmarks`, `/data-quality`) redirect to `/c/pmle/…`. The former source and Common views redirect to All Questions, keeping the query string: `/pdf`, `/examprepper`, `/common(/…)` → `/c/pmle/questions`; `/c/<slug>/common(/…)` and `/c/<slug>/sources/<id>` → `/c/<slug>/questions` (all temporary redirects, `next.config.ts`). Old `?from=pdf|examprepper|common` links on question pages fall back to All Questions.
- **Pages under `/c/[cert]/`:** dashboard (`page.tsx`), `plan`, `practice` (+ `[id]`), `mock` (+ `[id]`), `questions` (+ `[code]`), `review`, `flagged`, `incorrect`, `bookmarks`, `theory` (+ `[id]`), `blueprint`, `analytics`, `history` (version history), `data-quality` (Exam Coverage & Quality, administrators only), `data` (admin Data Settings).
- **Sidebar** (`components/sidebar.tsx`): Dashboard, Study Plan, Practice, Mock Examination; **Questions & Review** (All Questions, Marked for Review, Flagged Questions, Incorrect Questions, Bookmarks); Study (Theory Checklist, Exam Blueprint, Analytics, Version History); Content, administrators only (Exam Coverage & Quality when a version is published, Data Settings); All certifications; Settings. Counts come from `sidebarData()` in the certification layout; source lists and the open-issue count are loaded for administrators only.
- **Autosave client** (`lib/sync-client.ts`, `components/sync-provider.tsx`, `components/autosave.tsx`): a per-user outbox that sends flag, note, theory, setting, study-task, answer, mock-answer, mock-mark, session-index and location changes to server actions. Each change carries a client timestamp (`rev`); the server ignores older writes. Unsent changes persist in `localStorage`, retry with exponential backoff (cap 30 s), survive reloads, are shared across tabs via `BroadcastChannel`, and pause on an expired session. Status: **Working** (e2e tests for offline, reload, multi-tab, hung request).
- **One-off server calls** from event handlers use `lib/call-server.ts` (`callServer`), converting network failures into inline messages.
- **Dev hydration marker:** pages set `html[data-hydrated="true"]` (`components/hydration-watch.tsx`), which the e2e tests wait on.

## 5. Backend architecture

There is no separate backend service. Server logic is: Server Components, server actions (`"use server"` files in `lib/`), and route handlers in `app/api/`.

### Route handlers (`app/api/`)

| Route | Method | Access | Purpose |
|---|---|---|---|
| `/api/health` | GET | public | Liveness: runs `examDomain.count()`; 200 `{ok:true}` or 503. |
| `/api/me/backup`, `/api/export/progress` | GET | signed-in | Download the caller's personal progress backup (JSON, format v4: neutral question references `#<n>:<number>` plus question codes, no source identities). `export/progress` re-exports the same handler. |
| `/api/me/restore` | POST | signed-in, same-origin | Validate and merge-restore a personal backup (max 25 MB). Accepts v1 to v4; v1 to v3 files with raw source keys restore as before. |
| `/api/export/questions` | GET | signed-in | Question export as JSON/CSV. The `sources`, `sourcePage` and `sourceUrl` columns are included for administrators only. |
| `/api/pdf` | GET `?v=&s=` | admin | Streams a stored source PDF (from `UploadedFile.data`, or legacy `data/raw/pdf/` file). Learners get 404. Non-published versions only for content managers. |
| `/api/exhibit` | GET `?q=&i=` | signed-in | Streams exhibit image `i` of canonical question `q` (primary occurrence's local copy). Visible versions for everyone, drafts for content managers. Path confined to `public/question-assets/`, image types allowlisted, `cache-control: private`, `nosniff`. |
| `/api/ingest/upload` | POST | admin + elevated, same-origin | Stores a PDF/JSON upload and creates a **pending** ingestion job. 25 MB limit. Does not start processing. |
| `/api/backup` | GET, POST | admin + elevated | List / create server-side database snapshots. |
| `/api/admin/db-snapshot` | GET | admin + elevated | Download a fresh snapshot. |

### Server actions (selected; all validate with Zod)

| File | Actions |
|---|---|
| `lib/auth-actions.ts` | `loginAction`, `logoutAction` |
| `lib/admin-actions.ts` | `elevateAction`, `dropElevationAction` (admin step-up) |
| `lib/actions.ts`, learner autosave (via `sync()` wrapper, return `Ack`) | `submitAnswer`, `syncFlag`, `bulkClearFlags`, `saveNote`, `deleteNote`, `syncTheory`, `syncSettings`, `syncStudyTask`, `recordLocation`, `setSessionIndex`, `saveMockAnswer`, `setMockMark` |
| `lib/actions.ts`, learner sessions | `createPracticeSession`, `finishPracticeSession`, `abandonSession`, `createMockExam`, `submitMock` |
| `lib/actions.ts`, admin, drafts only | `decideDuplicate`, `resolveAnswer`, `setIssueStatus`, `setManualClassification`, `setOccurrenceExcluded` |
| `lib/content-actions.ts`, admin | `createCertificationAction`, `updateCertificationAction`, `createDraftAction`, `submitForReviewAction`, `returnToDraftAction`, `publishVersionAction`, `deleteDraftAction`, `submitUrlAction`, `startProcessingAction`, `retryJobAction`, `cancelJobAction`, `removeSourceAction`, `editQuestionAction` |
| `lib/list-actions.ts` | `createPracticeFromList` |
| `lib/io-actions.ts` | `backupAction` |

### Key business-logic modules

`lib/versions.ts` (draft/review/publish, fingerprint, readiness), `lib/canonicalize.ts` (merge source occurrences into canonical questions), `lib/verification.ts` (answer confidence from claims), `lib/grading.ts`, `lib/selection.ts` + `lib/allocation.ts` (practice/mock selection), `lib/mock.ts` (mock grading), `lib/ingest/*` (ingestion), `lib/quality.ts` (draft quality metrics, per-source counts, exhibit gaps), `lib/blueprint.ts` (Blueprint Distribution Alignment, verification gate, guide-weight parsing; pure), `lib/exhibits.ts` (neutral exhibit URLs, path confinement), `lib/question-edit.ts` (manual question edits), `lib/review-queue.ts`, `lib/bulk.ts` (typed bulk SQL), `lib/progress-io.ts` (personal backup), `lib/backup*.ts` (database snapshots), `lib/claim.ts`.

## 6. Authentication and authorization

Mechanism (all **Working**, covered by `tests/unit/auth.test.ts`, `tests/integration/multi-user.test.ts`, e2e):

1. `loginAction` (`lib/auth-actions.ts`) normalises the email (NFKC, trim, lower-case), validates it (`lib/auth-rules.ts`: regex, reserved TLDs `invalid/localhost/test/example/local` rejected, domain must be in `ALLOWED_EMAIL_DOMAINS`; unset means anyone in development and nobody in production; `*` allows all), upserts a `User`, creates an `AuthSession`, and sets cookie `pmle_session`.
2. The cookie holds a random 256-bit token; only its SHA-256 is stored (`AuthSession.tokenHash`). Cookie is `httpOnly`, `SameSite=Lax`, `Secure` on HTTPS (`COOKIE_SECURE` overrides). Sessions slide (`SESSION_TTL_DAYS`, default 30, max 365; refreshed when last used more than 12 h ago).
3. `proxy.ts` (Next.js middleware equivalent) is an optimistic gate: no cookie means redirect to `/login` (or 401 JSON for `/api/*`) except `/login`, `/api/health` and server-action requests. It also re-issues the cookie on GET and sets `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`.
4. The real check is `getCurrentUser()` in `lib/auth.ts`, which resolves the token against the database for every page (`requireUser`), server action and API route (`apiUser`).
5. Login rate limit: 30 attempts per 10 minutes per IP, **in-memory per server process** (`attemptsByIp`), using `x-forwarded-for`/`x-real-ip`.
6. Open-redirect protection on `next` (`safeNext`); cross-site POST rejection on state-changing routes (`sameOrigin`).

Email alone is identification, not proof of identity; anyone who knows an allowed address can sign in as that user (stated in `docs/DEPLOYMENT.md`). There is no password, email verification or SSO.

## 7. User roles and permissions

There is **no role table**. Roles are derived at request time (`lib/auth.ts: CurrentUser`):

| Role | How determined | Can do |
|---|---|---|
| Learner | Signed in with an allowed domain | Study published/archived content of any visible certification; all personal data scoped to own `userId`. Sees questions under neutral labels ("Source", "Source 1…N") without original source names, URLs, pages, files or keys; no Exam Coverage & Quality page (404). |
| Admin (allowlisted) | Email in `ADMIN_EMAILS` | Sees unpublished certifications and drafts and full source provenance (names, PDF links, source filters, sorts and search, export columns); opens Data Settings and Exam Coverage & Quality in read-only mode until elevated. |
| Admin (elevated) = `canManageContent` | Allowlisted **and** session unlocked | Changes shared content: certifications, versions, ingestion, duplicate/answer/classification decisions, question edits, snapshots. |

Elevation (`lib/admin-actions.ts`): the user enters `ADMIN_ACCESS_CODE` (min 8 chars) in Settings; compared in constant time; valid for `ADMIN_ELEVATION_HOURS` (default 8, 1 to 24), stored in `AuthSession.elevatedUntil`; 5 failures in 15 minutes lock the account (counted from `AuditEvent`). With no code set: development lets allowlisted users through ("exempt"); production fails closed ("disabled"). Admin events are written to `AuditEvent`.

There are no personal workspaces, organisations or per-certification roles.

## 8. Student-facing functionality

| Feature | Status | Notes / files |
|---|---|---|
| Certification home with per-certification progress, drafts hidden from learners | Working | `app/(portal)/(home)/page.tsx`, `lib/cert.ts: loadHomeCards` |
| Dashboard, continue-where-you-left-off | Working | `app/(portal)/c/[cert]/page.tsx`, `User.lastPath` via `recordLocation` |
| Questions & Review views (All Questions, Marked for Review, Flagged, Incorrect, Bookmarks), filters, search, jump, prev/next | Working | `components/question-bank.tsx`, `lib/questions.ts`, `lib/filters.ts`. Source filter, source sorts and source-number search are administrator-only and ignored for learners (`learnerFilters`). |
| Question card: single/multi-select, partial credit, notes, flags, attempt history, neutral source labels | Working | `components/question-card.tsx`, `lib/question-data.ts: toCardData` (redacts provenance for learners), `lib/actions.ts: submitAnswer` |
| Practice sessions (10 selection modes plus "practice this list"; the source-membership mode `common` is administrator-only), resumable, summaries | Working | `lib/selection.ts`, `components/practice-*.tsx`. Older sessions titled after a source display as "All Questions"; stored titles are unchanged. |
| Mock exam (default 60 questions / 120 min, weight-based domain allocation, refresh-safe timer, auto-submit) | Working | `lib/actions.ts: createMockExam`, `lib/mock.ts`, `components/mock-runner.tsx` |
| Theory checklist (status, confidence, notes per concept) | Working for PMLE | `lib/actions.ts: syncTheory`; concepts exist only where a version has them |
| Exam Blueprint (official weights as published, weight vs. bank share, objectives and considerations; no personal stats or score), analytics (including revision queue), study plan | Working | `app/(portal)/c/[cert]/blueprint/page.tsx`, `components/blueprint-share.tsx`, `lib/analytics.ts`, `lib/plan.ts` |
| Settings (exam date, hours, practice/mock defaults, theme, shortcuts) | Working | `lib/settings.ts` (stored per user in `Setting`) |
| Personal backup download and merge restore (format v4, neutral references) | Working | `lib/progress-io.ts` |
| Version history (progress on archived versions) | Partial | `history/page.tsx` lists per-version stats and the last 100 attempts of a chosen archived version. Practice, mock and browsing always use the **current published** version; archived questions cannot be practised from the UI. |
| Study features for certifications other than PMLE | Unverified | Code is certification-agnostic and e2e-tested with a 4-question fixture; no second real certification has been published. |

Behavioural details:

- Learners can read only versions with status `published` or `archived`; drafts/review return "not found" (`lib/cert.ts`, `lib/actions.ts`).
- Progress is per question **per version**. A new published version starts with fresh progress; attempts on the old version stay and appear in Version History.
- Learner page data, APIs, exports, backups and exhibit URLs carry no original source identity (`toCardData`, `CertProvider sources` empty for learners, `/api/exhibit`). The original image files remain at their paths under `public/question-assets/` behind sign-in; no learner response references them.
- Answers are graded only if the question's verification status is gradable (`verified`, `source_key`, `user_verified`, plus `contested` when the user enables `gradeContested`) and it has a complete key. Otherwise feedback is provisional and `isCorrect` is null (`lib/verification.ts`, `lib/grading.ts`).

## 9. Admin-facing functionality

All in `/c/[cert]/data` (Data Settings), `/c/[cert]/data-quality` (Exam Coverage & Quality), `/certifications/new`, and `/settings#admin-access`.

| Feature | Status | Notes |
|---|---|---|
| Admin step-up (access code) | Working | section 7 |
| Add certification (creates certification, an empty draft, and optionally a first source) | Working | `createCertificationAction`, `components/new-certification-form.tsx` |
| Edit certification details (name, provider, description, active/archived) | Working | `updateCertificationAction` |
| Versions table, create draft (empty / copy exam guide / copy everything), duplicate-label rejection, delete unpublished draft | Working | `lib/versions.ts`, `components/data-settings.tsx` |
| Source intake: PDF/JSON upload, website URL, multiple sources per draft, remove source | Working | `app/api/ingest/upload/route.ts`, `submitUrlAction`, `removeSourceAction` |
| Explicit **Start processing**, retry, cancel; lifecycle stepper; per-source status/counts/errors | Working | `lib/ingest/jobs.ts`, `app/(portal)/c/[cert]/data/page.tsx`. Verified end to end on a Neon demo schema on 2026-11-05. |
| Exam Coverage & Quality (administrators only; learners get 404). Overview: Blueprint Distribution Alignment card with the unique question count, exam weight vs. bank share, domain coverage table, a separate question-quality card (overlap, conflicts, review items, verification and legacy breakdowns, exhibits without a local copy, validity metrics), and a per-source table under neutral labels. Extraction reports with real source names are on the Import runs tab. | Working | `lib/quality.ts`, `lib/blueprint.ts`, `components/distribution-card.tsx`, `components/blueprint-share.tsx`, `app/(portal)/c/[cert]/data-quality/page.tsx` |
| Blueprint Distribution Alignment: 100 × Σ min(bank share, scaled official weight) over all unique questions (unmapped count as misaligned). Measures only the domain mix, not readiness, completeness, accuracy or quality. Shown only when `BLUEPRINT_VERIFIED_WEIGHTS` holds the version's stored weights exactly; otherwise "unavailable" with the reason. | Working | Verified for production `ver_pmle_2026` on 2026-11-21 (read-only; plan section 14). `scripts/verify-exam-weights.ts` repeats the check. |
| Questions tab: filters, search, provenance, inline question editor, exclude/restore source occurrence | Working | `components/question-editor.tsx`, `lib/question-edit.ts` |
| Duplicate decisions (same/different/undo), answer resolution, issue resolve/ignore, manual classification | Working | `lib/actions.ts`, `components/dq-actions.tsx` |
| Review readiness, submit for review, publish (atomic, fingerprint-checked), return to draft | Working | `lib/versions.ts` |
| Audit trail (change history) | Working | `AuditEvent`, shown in Data Settings |
| Server database snapshots and download | Partial | `lib/backup.ts`. SQLite: file copy. PostgreSQL: requires `pg_dump` on the server (test for it is skipped when absent). Not verified against Neon. |
| Create or edit exam objectives, domains, theory concepts in the UI | **Missing** | They exist only from the PMLE bootstrap import or by copying from an earlier version. New certifications have zero objectives, so questions are "unmapped" (warning only; publishing is allowed). |
| Ingestion of an exam guide (`purpose = "guide"` in schema) | **Missing** | Only `purpose = "questions"` is ever created (`lib/ingest/jobs.ts`). |
| Manage users or admins in the UI | **Missing** | Admin list is the `ADMIN_EMAILS` environment variable. |

## 10. Certification and examination management

- `Certification` (slug, code, name, provider, status active/archived, `currentVersionId`) owns many `ContentVersion` rows (`draft → review → published → archived`; unique `(certificationId, label)`; label regex `lib/cert-rules.ts: VERSION_LABEL_RE`).
- Publishing sets `currentVersionId`, archives the previous version, and never deletes. Published/archived versions are immutable at the application level (editable statuses are only `draft` and `review`; `assertEditable`). Nothing at the database level (triggers, permissions) prevents writes to a published version; immutability is enforced in application code.
- A content fingerprint (SHA-256 of canonical content) is stored at submit-for-review and re-checked at publish, so edits between review and publish block publishing.
- Home visibility: learners see a certification only if it is `active` with a published current version; admins see all.
- Exam taking is "practice" and "mock" `PracticeSession`s against the published version (section 12). There is no proctoring, scheduling or certification-authority integration.

## 11. Question bank management and ingestion

Detailed reference: [INGESTION.md](INGESTION.md). Summary of what exists:

- **Adapters** (`lib/ingest/pipeline.ts`): PDF (PyMuPDF text, Tesseract OCR for image-only pages, low confidence), website (plain HTTP, then headless Chromium, then screenshot OCR; robots.txt honoured; access walls/CAPTCHA stop the job; private-network URLs refused by `url-safety.ts`), manual JSON (`cert-prep-questions/v1`).
- **Pipeline:** intake, extraction, normalisation, duplicate detection (exact hash + fuzzy), objective classification, validation, write into the draft, canonical rebuild, review queue refresh.
- **Jobs:** persisted `IngestionJob` rows (`pending → queued → processing → review_required | failed`, plus `cancelled`/`removed`), 3 attempts with backoff, 30-minute lease, one running job per draft. Processing runs inline after the response (`next/server after()` in `lib/ingest/kick.ts`) unless `INGEST_INLINE=off`, or via `npm run ingest:worker`.
- **Canonical questions:** `lib/canonicalize.ts` merges `SourceOccurrence` rows (per source) into `CanonicalQuestion` rows using exact and approved fuzzy duplicate links; answer keys become `AnswerClaim` rows and `lib/verification.ts` derives the verification status.
- **PMLE bootstrap (legacy path):** `scripts/pipeline.py` (Python, offline) produces `data/processed/bank.json`; `scripts/import-db.ts` imports it into a draft (`npm run setup` also publishes it). This is how PMLE 2026 was created. It is separate from the in-app ingestion pipeline.
- **Real-source results (2026-11-05):** examprepper.co returned HTTP 403 (reported, not bypassed); itexams.com (HTML, 5 questions) and examtopics.com (screenshot OCR, 10 questions) extracted successfully; certification-questions.com failed with `NO_QUESTIONS`. Site behaviour changes; re-verify before relying on any source.
- **OCR quality:** OCR-read text contains noise and no answer key; such questions are flagged as blocking review items (`low_confidence_extraction`) that an admin must edit/resolve/exclude before submit-for-review.

## 12. Exam taking, scoring and progress

- **Practice** (`createPracticeSession`): rows are loaded for the user and version, `selectPractice` picks IDs by mode (`all, common, domain, topic, incorrect, unattempted, flagged, marked, high_alignment, weak_area`), seeded shuffle; creates `PracticeSession` + ordered `SessionQuestion`s. Each answer calls `submitAnswer`, writing a `QuestionAttempt` (idempotent on `(userId, clientId)`) and updating the `SessionQuestion`.
- **Mock** (`createMockExam`): `selectMock` allocates questions per domain by exam-guide weight (largest-remainder), with a `redistribute` or `shrink` fallback when a domain has too few questions (the shortfall is disclosed in the session allocation). Session has `timeLimitSec` and `deadlineAt`; answers autosave (`saveMockAnswer`, rejected after the deadline plus 5 s). `submitMockSession` grades once (claims the session with a status update inside a transaction), writes one `QuestionAttempt` per answered question, and stores a results JSON (graded score, provisional matches, by-domain, weak concepts, recommendations). Results report graded questions (correct, incorrect, partial, unanswered, score %) separately from provisional ones (questions without a verified key). How the score percentage treats unanswered questions was not verified.
- **Progress data:** attempts, flags (`review`/`flag`/`bookmark`), notes, theory progress, study-plan ticks, settings and last location, all keyed by `userId`; question-linked rows are also version-scoped through the question.
- **Not implemented:** spaced repetition scheduling, leaderboards/cohort analytics, instructor views of learner progress, certificates.

## 13. Key workflows (step by step)

**Sign-in.** Enter email, `loginAction` validates domain, upserts user, creates session, sets cookie, redirects to `next` or `/`. Logout deletes the session row.

**Answer a question.** Client enqueues `answer` with a fresh `clientId` into the outbox, `submitAnswer` verifies the user and that the question's version is published/archived, grades, inserts `QuestionAttempt` (retry-safe), returns the outcome and (if gradable) the key.

**Mock exam.** Create (60 questions, allocated by domain weight) → answers and marks autosave → submit or auto-submit at deadline → results page from stored JSON → attempts appear in analytics and the Incorrect list.

**Add content and publish (admin).**
1. Settings → enter access code.
2. Home → Add certification (or open a certification's Data Settings and create a draft; empty, or copy guide/all from the published version).
3. Add sources to the draft: upload a PDF/JSON or enter a website URL. Each becomes a **pending** job; nothing is processed yet.
4. Click **Start processing**: pending jobs become queued and run in the background, one at a time.
5. Watch source states (waiting, queued, processing, processed, failed). Retry or remove failed sources.
6. Open Exam Coverage & Quality for the draft: review summary, edit questions, decide duplicates, resolve or ignore issues, exclude bad occurrences.
7. Data Settings → readiness shows blockers → Submit for review (computes fingerprint) → Publish (atomic; previous version archived).
8. Learners now see the new version; they start with fresh progress on it.

**Correct published content.** Create a draft with "copy everything", fix it, submit, publish. The published version itself is never edited.

## 14. Integrations and external dependencies

- **PostgreSQL on Neon** (production, region ap-southeast-1 at last verification, project IDs deliberately not recorded here). Used through Prisma only.
- **Public websites** fetched by the website adapter (`lib/ingest/fetcher.ts`, `renderer.ts`, `robots.ts`), subject to robots.txt and access walls.
- **Local binaries:** Python + PyMuPDF (PDF), Tesseract (OCR), Playwright Chromium (JS rendering), `pg_dump` (PostgreSQL snapshots).
- No third-party auth, email, analytics, payment or AI/LLM services are called by the application code.

## 15. Configuration and environment

Variables read by the code (names only; see `.env.example` for comments, [DEPLOYMENT.md](DEPLOYMENT.md) for guidance). `.env` is gitignored.

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Query connection and migration connection. `file:` prefix selects SQLite; `postgres(ql)://` selects PostgreSQL. `DIRECT_URL` defaults to `DATABASE_URL`. Neon: pooled URL for queries, without `pgbouncer=true`; optional `&schema=NAME`. |
| `ALLOWED_EMAIL_DOMAINS` | Sign-in domain allowlist (`*` = any). |
| `ADMIN_EMAILS`, `ADMIN_ACCESS_CODE`, `ADMIN_ELEVATION_HOURS` | Admin allowlist, step-up secret (min 8 chars), unlock duration. |
| `SESSION_TTL_DAYS`, `COOKIE_SECURE` | Session lifetime; force cookie `Secure` flag. |
| `INGEST_PYTHON`, `INGEST_TESSERACT` | Absolute paths recommended (dev server PATH may differ from your shell). |
| `INGEST_BROWSER` (`off` disables), `INGEST_INLINE` (`off` disables in-process processing), `INGEST_ALLOW_PRIVATE_HOSTS` (`1`, ignored in production) | Ingestion behaviour. |
| `BACKUP_DIR`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP`, `BACKUP_RETENTION_DAYS` | Snapshots. Scheduler default: 24 h on SQLite, off on PostgreSQL. |
| `DEV_ALLOWED_ORIGINS` | Extra dev origins for `next dev` (`lib/dev-origins.ts`). |
| `BLUEPRINT_VERIFIED_WEIGHTS` | `<versionId>=<w1>,…;…`: per content version, the stored exam-domain weights that passed `scripts/verify-exam-weights.ts`. Gates the admin Blueprint Distribution Alignment score; unset or different means "unavailable". |

Runtime requirements: Node 20.9+ (README, DEPLOYMENT.md); `scripts/copy-sqlite-to-postgres.ts` needs Node 22.13+ (`node:sqlite`); Python venv with `requirements.txt` for the PMLE pipeline and PDFs. `next.config.ts` raises the proxy body limit to 26 MB for uploads and the server-action body limit is 2 MB. Local data files `data/pmle.db`, `data/backups/`, `data/test-*.db` are gitignored.

Local commands: `npm run setup` (migrate + generate + import PMLE bank), `npm run dev`, `npm run build`, `npm run test`, `npm run test:e2e`, `npm run db:*`, `npm run ingest:worker`, `npm run backup`.

## 16. Testing and validation

Last run on 2026-11-21 (after the final change; re-run before relying on these numbers):

| Suite | Result |
|---|---|
| `tsc --noEmit`, `eslint .`, `next build` | clean (the build prints a Next.js security advisory for 16.4.3; see section 17) |
| Vitest on PostgreSQL via PGlite (`TEST_PG_URL`, `--no-file-parallelism`, `pglite-server --max-connections=4`) | 221 passed, 3 skipped |
| Vitest on SQLite | 224 passed |
| Playwright e2e (SQLite database, port 3100) | 23 passed |

- Test files: `tests/unit/*` (grading, allocation, selection, verification, dedupe, ingestion, auth rules, bulk SQL, stats/plan, blueprint and filters, exhibits, distribution card, weight verifier), `tests/integration/*` (app data, certifications/versions/ingestion/editing, multi-user, source abstraction, coverage, SQLite-only migration), `tests/e2e/app.spec.ts` (includes a learner source-leak suite and an admin provenance suite).
- PGlite's socket server allows one connection by default; the backup round-trip test opens a second client, so start it with `--max-connections` above 1.
- The Prisma client is generated for **one** provider at a time; switching between SQLite tests/e2e and PostgreSQL requires `npm run db:generate` with the right `DATABASE_URL`. Running Vitest with `TEST_PG_URL` set in the shell silently selects PostgreSQL.
- **Never run tests against Neon.** Tests create and drop schemas named `test_*`.
- An admin end-to-end flow (create draft, upload text and scanned PDFs, add a website, process, retry, edit, resolve, publish, learner view) was executed manually through a browser script against a Neon demo schema on 2026-11-05; it is not an automated test. The Playwright admin test uses a JSON fixture instead.
- Production Neon data check (2026-11-05): PMLE 2026 published and live, 339 questions, stored fingerprint equals recomputed fingerprint.
- Not covered by automated tests: real website ingestion, real Tesseract OCR path in CI (an adapter test covers the "OCR unavailable" refusal), `pg_dump` snapshots, Neon-specific behaviour.

## 17. Known limitations, gaps and technical concerns

Functional gaps (see sections 8 and 9): no UI for objectives/domains/theory concepts; guide ingestion not implemented; archived versions viewable only through history; no admin/user management UI.

Technical concerns:

1. **Uncommitted work.** One git commit exists; the multi-user and multi-certification changes are not in version control.
2. **Two database providers, two migration histories.** `prisma/schema.prisma` is SQLite and the source of truth; `prisma/postgres/schema.prisma` is generated by `scripts/db.mjs`. SQLite has 3 migrations, PostgreSQL has 2 (its `init` folds in the multi-user changes). Schema changes must be made in both migration folders by hand. Details in [DATABASE.md](architecture/DATABASE.md).
3. **Raw SQL depends on Prisma internals.** `lib/bulk.ts` reads `_engineConfig.overrideDatasources` to find the schema because Neon's pooler does not preserve `search_path`; a Prisma upgrade could break this.
4. **Application-level immutability only** for published versions (no database constraint).
5. **Background processing is in-process.** `after()` work can be cut short on serverless hosts; a crashed worker leaves a job "processing" until its 30-minute lease expires.
6. **Login rate limiting is per process and trusts `x-forwarded-for`**; multiple instances do not share counters.
7. **Uploaded files are stored as `Bytes` in the database** (up to 25 MB each).
8. **Identification, not authentication.** Email-only sign-in; network-level controls recommended in `docs/DEPLOYMENT.md`.
9. **Question counts can change when content is added to a draft that already holds a bank**, because canonical questions are rebuilt and new duplicate links merge occurrences (behaviour of `lib/canonicalize.ts`; the exact effect on a given bank was not documented).
10. **Unprocessed OCR output is noisy** (e.g. "Vertex Al") and carries no answer key; it is gated by a blocking review item.
11. **Neon CLI features** (init/deploy/branching, `neon.ts`, `.neon`) were not completed; they need an interactive `neon login`. The app does not depend on them.
12. **Next.js advisory.** `next build` reports that Next.js 16.4.3 is affected by a known security vulnerability and recommends upgrading. Not addressed in the 2026-11-21 change (no dependency changes).
13. **Credentials were pasted into chat during development** (Neon owner password). Rotating it is recommended; it is not recorded in any tracked file.

Known documentation inconsistencies (code wins):

- `README.md` still describes only PMLE, a "66 Degrees" email requirement and a "Data Settings (admins only)" summary; it does not mention Neon or the explicit Start-processing flow.
- `PROGRESS.md` states "Neon not yet provisioned" and older test counts; production now runs on Neon and counts differ.
- `docs/DEPLOYMENT.md` section 3 treats Neon setup as a future step; it has been performed for this project (the operational steps remain correct).
- `scripts/pipeline.py` is invoked by `npm run ingest:python` as `../.venv/bin/python`, a path outside the application folder.
