# Implementation progress

Status as of 2026-11-05: **multi-certification code complete and tested locally (SQLite and PostgreSQL via PGlite); Neon not yet provisioned** (see docs/DEPLOYMENT.md, sections 1 and 3).

## Multi-certification release (2026-11-05)

- [x] Certification home after sign-in (latest version and progress per card, empty state); every study page moved under `/c/<code>/…`, with old PMLE URLs redirecting
- [x] Data model: `Certification`, `ContentVersion` (draft → review → published → archived), `UploadedFile`, `IngestionJob`, `AuditEvent`; content tables scoped by version; lossless migration that keeps all IDs and progress (SQLite and PostgreSQL)
- [x] Immutable published versions with a content fingerprint; correction drafts; atomic publish that archives the old version; fresh per-version progress with old progress viewable; changed questions never carried over as done
- [x] PDE listed with no question content; Add Certification (admin only) always creates a draft that learners can't see
- [x] Admin step-up with `ADMIN_ACCESS_CODE` (disabled in production when unset, throttled), server-side checks on every admin action, audit log
- [x] Ingestion pipeline: PDF (PyMuPDF and optional Tesseract), website (HTTP → headless browser → screenshot OCR), manual JSON import; robots.txt, access-wall and private-address refusal; exact and near-duplicate detection; validation; persisted jobs with leases, backoff and retries; `npm run ingest:worker`
- [x] Data Settings page per certification: details, versions, review readiness, publish, sources and uploads, jobs with stage logs and retry/cancel
- [x] Backup format v3 (per version, accepts v1 and v2); claim and SQLite→PostgreSQL copy are version-aware
- [x] Tests: 158 Vitest on SQLite; the integration suite on PostgreSQL via PGlite (48 passed, 3 skipped: two SQLite-only migration tests and one that needs `pg_dump`); 18 Playwright; lint, typecheck and build clean
- [ ] Remaining (operator): create the Neon project and set `DATABASE_URL`, `DIRECT_URL` and `ADMIN_ACCESS_CODE`; optionally install Tesseract; verify ingestion against a real source you are permitted to use
- [ ] Remaining (content): PDE questions and objectives must come from a source you are allowed to use; none are bundled

## Multi-user release (2026-10-28)

- [x] Email sign-in (allowed domains, auto-create, httpOnly sliding sessions, rate limit, logout in Settings); proxy and server-side checks on every page, action and API
- [x] Per-user data (attempts, flags, notes, theory, sessions, plan, settings, last location) keyed by `userId`; question bank and admin decisions shared; admin-only data-quality edits
- [x] SQLite locally, PostgreSQL in production (`scripts/db.mjs` picks the provider); Postgres migrations verified against the schema; one-time SQLite→Postgres copy script
- [x] Existing progress kept under a placeholder account by the migration; `npm run claim-local-progress -- <email>` assigns it
- [x] Autosave outbox: immediate and debounced saves, merge, retry with backoff, offline and expired-session handling, persisted unsent changes, stale-write protection, multi-tab refresh, save indicator, resume link
- [x] Personal JSON backup download and validated merge-restore; scheduled whole-database snapshots with retention; admin snapshot download; health endpoint
- [x] Tests: 84 Vitest (unit and integration; integration also run on PostgreSQL via PGlite), 11 Playwright; typecheck, lint and build clean
- [x] Next.js patched 16.4.0 → 16.4.3 (critical advisories)
- [ ] Remaining (operator): provision Postgres, hosting with HTTPS, domain and admin env vars, provider backups and PITR; claim local progress

## Single-user release (2026-10-11)

## Done

- [x] Ingestion: PDF extraction (PyMuPDF), ExamPrepper page capture (68/68 pages), classification against the June 2026 guide, legacy detection, three-stage dedup, idempotent DB import with provenance and reports
- [x] Answer verification (verified / single-source key / contested / conflict / user-resolved); unverified answers never graded
- [x] Canonical IDs stable across reimports; duplicate approve/reject/undo moves user activity with the question
- [x] Inventory identity on the Dashboard and Data Quality: 338 + 339 − 338 = 339
- [x] Question bank views (All, Common, PDF, ExamPrepper, Review, Flagged, Incorrect, Bookmarks) with filters, search, jump and prev/next within the current list
- [x] Question card: single/multi-select, partial feedback, reveal on request, traceability panel, notes, flags, attempt history, keyboard shortcuts
- [x] Practice sessions (10 modes plus "practice this list"), resumable, with summaries
- [x] Mock exam: weight-based allocation, refresh-safe timer, auto-submit, graded vs provisional results, history
- [x] Theory checklist (149 concepts), concept pages, Blueprint, Analytics with revision queue, Study Plan
- [x] Settings, progress export/import (merge, idempotent), question CSV/JSON export, backups
- [x] Tests: 43 unit, 10 integration, 5 Playwright e2e; typecheck and lint clean; `next build` passes
- [x] README with setup, reimport, backup/restore and known limitations

## Fixed during verification

- Rejecting a fuzzy duplicate crashed on answer-claim key collisions when splitting a merged question (found by integration tests)
- Mock deadline could drift 1 ms from the start time
- Plan showed study days on exam day; theory checklist too long when fully expanded; mock refresh prompt blocked resume

## Open / nice to have

- Review the 62 low-confidence classifications; Domain 2 is probably over-assigned (103 questions)
- Resolve the 49 answer conflicts (Data Quality → Answers) to make them gradable
- Five PDF multi-select questions have incomplete keys
