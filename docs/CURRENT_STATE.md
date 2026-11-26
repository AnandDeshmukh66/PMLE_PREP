# Current state

Audit baseline: **2026-11-20**, updated **2026-11-21** for the Questions & Review consolidation and Exam Coverage & Quality ([plan](implementation-plans/exam-guide-mapping.md)) and **2026-11-24** for the removal of Data Settings, Add Certification and in-app exam ingestion ([plan](implementation-plans/remove-data-settings-and-exam-ingestion.md)). Describes the application as it exists in the working tree. Test and live-data figures come from the last verification run (**2026-11-05**) and are labelled as such. See [README.md](README.md) for how this file is maintained and [architecture/](architecture/) for structure details.

Status labels: **Working** (implemented and exercised by tests or manual runs), **Partial** (implemented with stated gaps), **Unverified** (code exists, not exercised), **Missing** (not implemented).

## 1. Overview

PMLE Prep is an internal study portal for professional-certification exam practice. It started as a single-certification (Google Cloud Professional Machine Learning Engineer, "PMLE") question-bank viewer and now supports multiple certifications, each with immutable, versioned content. Learners practise questions, take timed mock exams, track theory coverage and progress; administrators review the question bank's coverage and quality (read-only) and take server backups. Content is loaded offline with `scripts/import-db.ts`; there is no in-app content management, upload or ingestion.

- Sign-in is by company email only (no password). See section 6.
- Content shipped: PMLE 2026, bootstrapped from a local PDF and an ExamPrepper capture (339 canonical questions, 149 theory concepts, mapped to the June 2026 exam guide). Professional Data Engineer (PDE) exists as a certification record with **no published content** on the production database; test/demo drafts for it were created only in a separate `demo_e2e` schema.
- Source repository: a single commit exists (`5183c75`); essentially all multi-user and multi-certification work is **uncommitted** in the working tree (`git status --short` lists 116 entries on 2026-11-20, including untracked directories).

## 2. Technology stack

| Area | Technology (from `package.json`) |
|---|---|
| Framework | Next.js 16.4.3 (App Router, Turbopack), React 19.2, TypeScript 5. `AGENTS.md` warns this Next.js version has breaking changes; read `node_modules/next/dist/docs/` before changing framework-level code. |
| UI | Tailwind CSS 4, `lucide-react`, `recharts`, `clsx`, `tailwind-merge`. No component library; primitives are in `components/ui.tsx`. |
| Data | Prisma 6.19.3. SQLite for local development, PostgreSQL (Neon) for production, chosen by `DATABASE_URL` prefix via `scripts/db.mjs`. |
| Validation | Zod 4 (server action/route inputs, settings, backup format). |
| Python tooling | PyMuPDF (PDF text), RapidFuzz, numpy, scikit-learn, requests (`requirements.txt`) for the PMLE bootstrap pipeline; PyMuPDF also serves `scripts/pdf_extract.py`, which `scripts/verify-exam-weights.ts` uses to read the official exam guide. |
| Optional binaries | Tesseract (optional OCR in `scripts/pdf_extract.py` for scanned guide pages); `pg_dump` (PostgreSQL snapshots). Playwright Chromium is used only by the e2e tests. |
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
    c/[cert]/...                      all study + admin pages for one certification
  api/                                route handlers (section 5)
components/                           client + shared UI (autosave, runners, sidebar)
lib/                                  business logic, server actions, auth, data access
prisma/                               schema.prisma (SQLite, source of truth), postgres/ (generated schema + own migrations), migrations/
scripts/                              db.mjs, import-db.ts, verify-exam-weights.ts, pdf_extract.py, backup, copy and claim scripts, Python pipeline
tests/                                unit, integration, e2e
data/                                 SQLite DB, backups, raw/processed PMLE source data, taxonomy (mostly gitignored)
docs/                                 documentation
proxy.ts, instrumentation.ts          request gate; boot-time backup scheduler
```

## 4. Frontend architecture and navigation

- **Rendering.** Server Components fetch data directly with Prisma (no REST layer for pages). Interactive parts are client components in `components/`. All portal routes are dynamic (`ƒ` in the build output).
- **Layouts.** `app/(portal)/layout.tsx` calls `requireUser()` and mounts `SyncProvider` (client autosave outbox). `app/(portal)/c/[cert]/layout.tsx` calls `certAdminPage()`, loads sidebar counts and renders `AppShell` + `Sidebar`; `(home)/layout.tsx` renders the shell without certification context.
- **Certification routing.** Every study page lives under `/c/<slug>/…` (`lib/cert-rules.ts: certBase`). Pre-multi-certification URLs (`/questions`, `/practice`, `/mock`, `/theory`, `/plan`, `/analytics`, `/blueprint`, `/review`, `/flagged`, `/incorrect`, `/bookmarks`, `/data-quality`) redirect to `/c/pmle/…`. The former source and Common views redirect to All Questions, keeping the query string: `/pdf`, `/examprepper`, `/common(/…)` → `/c/pmle/questions`; `/c/<slug>/common(/…)` and `/c/<slug>/sources/<id>` → `/c/<slug>/questions` (all temporary redirects, `next.config.ts`). Old `?from=pdf|examprepper|common` links on question pages fall back to All Questions.
- **Pages under `/c/[cert]/`:** dashboard (`page.tsx`), `plan`, `practice` (+ `[id]`), `mock` (+ `[id]`), `questions` (+ `[code]`), `review`, `flagged`, `incorrect`, `bookmarks`, `theory` (+ `[id]`), `blueprint`, `analytics`, `history` (version history), `data-quality` (Exam Coverage & Quality: administrators only, read-only, published version only). `/c/<slug>/data` and `/certifications/new` no longer exist (404).
- **Sidebar** (`components/sidebar.tsx`): Dashboard, Study Plan, Practice, Mock Examination; **Questions & Review** (All Questions, Marked for Review, Flagged Questions, Incorrect Questions, Bookmarks); Study (Theory Checklist, Exam Blueprint, Analytics, Version History); Content, administrators only (Exam Coverage & Quality when a version is published); All certifications; Settings. Counts come from `sidebarData()` in the certification layout; source lists and the open-issue count are loaded for administrators only.
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
| `/api/pdf` | GET `?v=&s=` | admin | Streams a stored source PDF (from `UploadedFile.data` where a row exists, else the `data/raw/pdf/` file). Learners get 404. Non-published versions only for content managers. |
| `/api/exhibit` | GET `?q=&i=` | signed-in | Streams exhibit image `i` of canonical question `q` (primary occurrence's local copy). Visible versions for everyone, drafts for content managers. Path confined to `public/question-assets/`, image types allowlisted, `cache-control: private`, `nosniff`. |
| `/api/backup` | GET, POST | admin + elevated | List / create server-side database snapshots. |
| `/api/admin/db-snapshot` | GET | admin + elevated | Download a fresh snapshot. |

### Server actions (selected; all validate with Zod)

| File | Actions |
|---|---|
| `lib/auth-actions.ts` | `loginAction`, `logoutAction` |
| `lib/admin-actions.ts` | `elevateAction`, `dropElevationAction` (admin step-up) |
| `lib/actions.ts`, learner autosave (via `sync()` wrapper, return `Ack`) | `submitAnswer`, `syncFlag`, `bulkClearFlags`, `saveNote`, `deleteNote`, `syncTheory`, `syncSettings`, `syncStudyTask`, `recordLocation`, `setSessionIndex`, `saveMockAnswer`, `setMockMark` |
| `lib/actions.ts`, learner sessions | `createPracticeSession`, `finishPracticeSession`, `abandonSession`, `createMockExam`, `submitMock` |
| `lib/list-actions.ts` | `createPracticeFromList` |
| `lib/io-actions.ts` | `backupAction` |

### Key business-logic modules

`lib/versions.ts` (version statuses, fingerprint, readiness; used by the offline import, no UI), `lib/canonicalize.ts` (merge source occurrences into canonical questions), `lib/verification.ts` (answer confidence from claims), `lib/grading.ts`, `lib/selection.ts` + `lib/allocation.ts` (practice/mock selection), `lib/mock.ts` (mock grading), `lib/quality.ts` (published-version quality metrics, per-source counts, exhibit gaps; `loadPublishedQuality` refuses draft, review and archived versions), `lib/blueprint.ts` (Blueprint Distribution Alignment, verification gate, guide-weight parsing; pure), `lib/exhibits.ts` (neutral exhibit URLs, path confinement), `lib/review-queue.ts`, `lib/bulk.ts` (typed bulk SQL), `lib/progress-io.ts` (personal backup), `lib/backup*.ts` (database snapshots), `lib/claim.ts`.

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
| Admin (allowlisted) | Email in `ADMIN_EMAILS` | Sees full source provenance (names, PDF links, source filters, sorts and search, export columns) and opens Exam Coverage & Quality (read-only, published version only). |
| Admin (elevated) = `canManageContent` | Allowlisted **and** session unlocked | Server database snapshots (`/api/backup`, `/api/admin/db-snapshot`) and access to PDFs of non-published versions. There are no in-app content changes left to unlock. |

Elevation (`lib/admin-actions.ts`): the user enters `ADMIN_ACCESS_CODE` (min 8 chars) in Settings; compared in constant time; valid for `ADMIN_ELEVATION_HOURS` (default 8, 1 to 24), stored in `AuthSession.elevatedUntil`; 5 failures in 15 minutes lock the account (counted from `AuditEvent`). With no code set: development lets allowlisted users through ("exempt"); production fails closed ("disabled"). Admin events are written to `AuditEvent`.

There are no personal workspaces, organisations or per-certification roles.

## 8. Student-facing functionality

| Feature | Status | Notes / files |
|---|---|---|
| Certification home with per-certification progress; only active certifications with a published version are listed, for everyone | Working | `app/(portal)/(home)/page.tsx`, `lib/cert.ts: loadHomeCards` |
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

Administrators have `/c/[cert]/data-quality` (Exam Coverage & Quality), `/settings#admin-access`, the server backup endpoints and the full source provenance described in section 7. The Data Settings page, Add Certification, in-app uploads and ingestion, draft/review/publish editing and question/duplicate/answer/classification editing were removed on 2026-11-24 ([plan](implementation-plans/remove-data-settings-and-exam-ingestion.md)); their routes return 404.

| Feature | Status | Notes |
|---|---|---|
| Admin step-up (access code) | Working | section 7 |
| Exam Coverage & Quality: administrators only (learners get 404), **read-only, published version only**. Eight tabs: Overview, Questions, Duplicates, Answer conflicts, Review queue, Classification, Outdated content, Import runs. The `version` query parameter is ignored and `loadPublishedQuality` throws for any draft, review or archived version, so unpublished content cannot be loaded. Overview: Blueprint Distribution Alignment card with the unique question count, exam weight vs. bank share, domain coverage table, a separate question-quality card (overlap, conflicts, review items, verification and legacy breakdowns, exhibits without a local copy, validity metrics), and a per-source table under neutral labels. Extraction reports with real source names are on the Import runs tab. | Working | `lib/quality.ts`, `lib/blueprint.ts`, `components/distribution-card.tsx`, `components/blueprint-share.tsx`, `app/(portal)/c/[cert]/data-quality/page.tsx`; tests in `tests/integration/coverage.test.ts` and e2e |
| Blueprint Distribution Alignment: 100 × Σ min(bank share, scaled official weight) over all unique questions (unmapped count as misaligned). Measures only the domain mix, not readiness, completeness, accuracy or quality. Shown only when `BLUEPRINT_VERIFIED_WEIGHTS` holds the version's stored weights exactly; otherwise "unavailable" with the reason. | Working | Verified for production `ver_pmle_2026` on 2026-11-21 (read-only; plan section 14). `scripts/verify-exam-weights.ts` repeats the check. |
| Source PDF view (`/api/pdf`) and exhibit images (`/api/exhibit`) | Working | Unchanged by the removal; see section 5. |
| Server database snapshots and download | Partial | `lib/backup.ts`. SQLite: file copy. PostgreSQL: requires `pg_dump` on the server (test for it is skipped when absent). Not verified against Neon. |
| Create, edit or publish certifications, versions, questions, objectives, domains or theory concepts in the UI | **Removed** | Content now arrives only through the offline import (section 11). |
| Manage users or admins in the UI | **Missing** | Admin list is the `ADMIN_EMAILS` environment variable. |

## 10. Certification and examination management

- `Certification` (slug, code, name, provider, status active/archived, `currentVersionId`) owns many `ContentVersion` rows (`draft → review → published → archived`; unique `(certificationId, label)`; label regex `lib/cert-rules.ts: VERSION_LABEL_RE`).
- Publishing (in `lib/versions.ts`, reachable only from the offline import, not from the UI) sets `currentVersionId`, archives the previous version, and never deletes. Published/archived versions are immutable at the application level (editable statuses are only `draft` and `review`; `assertEditable`). Nothing at the database level (triggers, permissions) prevents writes to a published version; immutability is enforced in application code.
- A content fingerprint (SHA-256 of canonical content) is stored at submit-for-review and re-checked at publish, so edits between review and publish block publishing.
- Home visibility: everyone, administrators included, sees a certification only if it is `active` with a published current version.
- Exam taking is "practice" and "mock" `PracticeSession`s against the published version (section 12). There is no proctoring, scheduling or certification-authority integration.

## 11. Question bank content (offline only)

In-app exam ingestion (PDF, website and JSON uploads, OCR, the job worker, draft review and publish) was removed on 2026-11-24. [INGESTION.md](INGESTION.md) is kept as an archived description of that former system. What remains:

- **Canonical questions:** `lib/canonicalize.ts` merges `SourceOccurrence` rows (per source) into `CanonicalQuestion` rows using exact and approved fuzzy duplicate links; answer keys become `AnswerClaim` rows and `lib/verification.ts` derives the verification status.
- **PMLE bootstrap (offline path):** `scripts/pipeline.py` (Python) produces `data/processed/bank.json`; `scripts/import-db.ts` imports it into a draft (`npm run setup` also publishes it). This is how PMLE 2026 was created and is the only way content enters the database.
- **Exam guide weights:** `scripts/verify-exam-weights.ts` reads the official guide PDF with `scripts/pdf_extract.py` (PyMuPDF) and compares it with the stored weights.
- **Retained, unused tables:** `IngestionJob` and `UploadedFile` stay in the schema and the database unchanged. `/api/pdf` still serves `UploadedFile.data` when a source has one, then falls back to `data/raw/pdf/`.

## 12. Exam taking, scoring and progress

- **Practice** (`createPracticeSession`): rows are loaded for the user and version, `selectPractice` picks IDs by mode (`all, common, domain, topic, incorrect, unattempted, flagged, marked, high_alignment, weak_area`), seeded shuffle; creates `PracticeSession` + ordered `SessionQuestion`s. Each answer calls `submitAnswer`, writing a `QuestionAttempt` (idempotent on `(userId, clientId)`) and updating the `SessionQuestion`.
- **Mock** (`createMockExam`): `selectMock` allocates questions per domain by exam-guide weight (largest-remainder), with a `redistribute` or `shrink` fallback when a domain has too few questions (the shortfall is disclosed in the session allocation). Session has `timeLimitSec` and `deadlineAt`; answers autosave (`saveMockAnswer`, rejected after the deadline plus 5 s). `submitMockSession` grades once (claims the session with a status update inside a transaction), writes one `QuestionAttempt` per answered question, and stores a results JSON (graded score, provisional matches, by-domain, weak concepts, recommendations). Results report graded questions (correct, incorrect, partial, unanswered, score %) separately from provisional ones (questions without a verified key). How the score percentage treats unanswered questions was not verified.
- **Progress data:** attempts, flags (`review`/`flag`/`bookmark`), notes, theory progress, study-plan ticks, settings and last location, all keyed by `userId`; question-linked rows are also version-scoped through the question.
- **Not implemented:** spaced repetition scheduling, leaderboards/cohort analytics, instructor views of learner progress, certificates.

## 13. Key workflows (step by step)

**Sign-in.** Enter email, `loginAction` validates domain, upserts user, creates session, sets cookie, redirects to `next` or `/`. Logout deletes the session row.

**Answer a question.** Client enqueues `answer` with a fresh `clientId` into the outbox, `submitAnswer` verifies the user and that the question's version is published/archived, grades, inserts `QuestionAttempt` (retry-safe), returns the outcome and (if gradable) the key.

**Mock exam.** Create (60 questions, allocated by domain weight) → answers and marks autosave → submit or auto-submit at deadline → results page from stored JSON → attempts appear in analytics and the Incorrect list.

**Review quality (admin).** Settings → (optional) enter the access code → Exam Coverage & Quality → read the overview and the eight read-only tabs for the published version.

**Load or correct content.** Offline only: update the source data, run the Python pipeline and `npm run ingest:db` (see [DEPLOYMENT.md](DEPLOYMENT.md)). The published version itself is never edited in the app.

## 14. Integrations and external dependencies

- **PostgreSQL on Neon** (production, region ap-southeast-1 at last verification, project IDs deliberately not recorded here). Used through Prisma only.
- **Local binaries:** Python + PyMuPDF (offline pipeline and weight verifier), optional Tesseract, `pg_dump` (PostgreSQL snapshots).
- No third-party auth, email, analytics, payment or AI/LLM services are called by the application code.

## 15. Configuration and environment

Variables read by the code (names only; see `.env.example` for comments, [DEPLOYMENT.md](DEPLOYMENT.md) for guidance). `.env` is gitignored.

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `DIRECT_URL` | Query connection and migration connection. `file:` prefix selects SQLite; `postgres(ql)://` selects PostgreSQL. `DIRECT_URL` defaults to `DATABASE_URL`. Neon: pooled URL for queries, without `pgbouncer=true`; optional `&schema=NAME`. |
| `ALLOWED_EMAIL_DOMAINS` | Sign-in domain allowlist (`*` = any). |
| `ADMIN_EMAILS`, `ADMIN_ACCESS_CODE`, `ADMIN_ELEVATION_HOURS` | Admin allowlist, step-up secret (min 8 chars), unlock duration. |
| `SESSION_TTL_DAYS`, `COOKIE_SECURE` | Session lifetime; force cookie `Secure` flag. |
| `INGEST_PYTHON` | Python with PyMuPDF for `scripts/verify-exam-weights.ts`; an absolute path is recommended. (The in-app ingestion variables `INGEST_TESSERACT`, `INGEST_BROWSER`, `INGEST_INLINE` and `INGEST_ALLOW_PRIVATE_HOSTS` are no longer read.) |
| `BACKUP_DIR`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP`, `BACKUP_RETENTION_DAYS` | Snapshots. Scheduler default: 24 h on SQLite, off on PostgreSQL. |
| `DEV_ALLOWED_ORIGINS` | Extra dev origins for `next dev` (`lib/dev-origins.ts`). |
| `BLUEPRINT_VERIFIED_WEIGHTS` | `<versionId>=<w1>,…;…`: per content version, the stored exam-domain weights that passed `scripts/verify-exam-weights.ts`. Gates the admin Blueprint Distribution Alignment score; unset or different means "unavailable". |

Runtime requirements: Node 20.9+ (README, DEPLOYMENT.md); `scripts/copy-sqlite-to-postgres.ts` needs Node 22.13+ (`node:sqlite`); Python venv with `requirements.txt` for the PMLE pipeline and PDFs. `next.config.ts` raises the proxy body limit to 26 MB for backup restores (`/api/me/restore`) and the server-action body limit is 2 MB. Local data files `data/pmle.db`, `data/backups/`, `data/test-*.db` are gitignored.

Local commands: `npm run setup` (migrate + generate + import PMLE bank), `npm run dev`, `npm run build`, `npm run test`, `npm run test:e2e`, `npm run db:*`, `npm run ingest` (offline pipeline + import), `npm run backup`.

## 16. Testing and validation

Last run on 2026-11-24 (after the removal of Data Settings and ingestion; re-run before relying on these numbers):

| Suite | Result |
|---|---|
| `tsc --noEmit`, `eslint .`, `next build` | clean (the build prints a Next.js security advisory for 16.4.3; see section 17) |
| Vitest on PostgreSQL via PGlite (`TEST_PG_URL`, `--no-file-parallelism`, `pglite-server --max-connections=4`) | 145 passed, 3 skipped |
| Vitest on SQLite | 148 passed |
| Playwright e2e (SQLite database, port 3100) | 25 passed |

- Test files: `tests/unit/*` (grading, allocation, selection, verification, dedupe, auth rules, bulk SQL, stats/plan, blueprint and filters, exhibits, distribution card, weight verifier), `tests/integration/*` (app data, multi-user, source abstraction, coverage, SQLite-only migration), `tests/e2e/app.spec.ts` (includes a learner source-leak suite and an admin provenance suite).
- PGlite's socket server allows one connection by default; the backup round-trip test opens a second client, so start it with `--max-connections` above 1.
- The Prisma client is generated for **one** provider at a time; switching between SQLite tests/e2e and PostgreSQL requires `npm run db:generate` with the right `DATABASE_URL`. Running Vitest with `TEST_PG_URL` set in the shell silently selects PostgreSQL.
- **Never run tests against Neon.** Tests create and drop schemas named `test_*`.
- The e2e database also holds an unpublished draft version (seeded by `tests/e2e/prepare-db.ts`) to prove that Exam Coverage & Quality never exposes it.
- Production Neon data check (2026-11-05): PMLE 2026 published and live, 339 questions, stored fingerprint equals recomputed fingerprint.
- Not covered by automated tests: `pg_dump` snapshots, Neon-specific behaviour.

## 17. Known limitations, gaps and technical concerns

Functional gaps (see sections 8 and 9): no in-app content management of any kind (by design since 2026-11-24); archived versions viewable only through history; no admin/user management UI.

Technical concerns:

1. **Uncommitted work.** One git commit exists; the multi-user and multi-certification changes are not in version control.
2. **Two database providers, two migration histories.** `prisma/schema.prisma` is SQLite and the source of truth; `prisma/postgres/schema.prisma` is generated by `scripts/db.mjs`. SQLite has 3 migrations, PostgreSQL has 2 (its `init` folds in the multi-user changes). Schema changes must be made in both migration folders by hand. Details in [DATABASE.md](architecture/DATABASE.md).
3. **Raw SQL depends on Prisma internals.** `lib/bulk.ts` reads `_engineConfig.overrideDatasources` to find the schema because Neon's pooler does not preserve `search_path`; a Prisma upgrade could break this.
4. **Application-level immutability only** for published versions (no database constraint).
5. **Retained but unused schema.** `IngestionJob` and `UploadedFile` (and the draft/review lifecycle code in `lib/versions.ts`) remain after the removal of the in-app workflows; they are intentionally untouched.
6. **Login rate limiting is per process and trusts `x-forwarded-for`**; multiple instances do not share counters.
7. **Previously uploaded files remain stored as `Bytes` in the database** (`UploadedFile.data`); nothing uploads new ones.
8. **Identification, not authentication.** Email-only sign-in; network-level controls recommended in `docs/DEPLOYMENT.md`.
9. **Question counts can change when the offline import adds content to a draft that already holds a bank**, because canonical questions are rebuilt and new duplicate links merge occurrences (behaviour of `lib/canonicalize.ts`; the exact effect on a given bank was not documented).
10. **Stored OCR-derived questions can be noisy** (e.g. "Vertex Al") and carry no answer key; they can no longer be corrected in the app.
11. **Neon CLI features** (init/deploy/branching, `neon.ts`, `.neon`) were not completed; they need an interactive `neon login`. The app does not depend on them.
12. **Next.js advisory.** `next build` reports that Next.js 16.4.3 is affected by a known security vulnerability and recommends upgrading. Not addressed in the 2026-11-21 change (no dependency changes).
13. **Credentials were pasted into chat during development** (Neon owner password). Rotating it is recommended; it is not recorded in any tracked file.

Known documentation inconsistencies (code wins):

- `README.md` still describes only PMLE and a "66 Degrees" email requirement; it does not mention Neon.
- `PROGRESS.md` states "Neon not yet provisioned" and older test counts; production now runs on Neon and counts differ.
- `docs/DEPLOYMENT.md` section 3 treats Neon setup as a future step; it has been performed for this project (the operational steps remain correct).
- `scripts/pipeline.py` is invoked by `npm run ingest:python` as `../.venv/bin/python`, a path outside the application folder.
