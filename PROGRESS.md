# Implementation progress

Status as of 2026-10-28: **multi-user, production-ready code complete and tested; production infrastructure still to be provisioned** (see docs/DEPLOYMENT.md, section 1).

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
