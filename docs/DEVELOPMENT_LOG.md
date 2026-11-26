# Development log

Append-only record of **meaningful completed work**. Newest entry first. Do not log every commit or minor fix (see [README.md](README.md), rule 3). Current behaviour belongs in [CURRENT_STATE.md](CURRENT_STATE.md), not here.

## Entry format

```markdown
## YYYY-MM-DD: Short title

- **Feature / change:** one line.
- **What was completed:** bullet list of outcomes (not a diary of steps).
- **Important files / areas:** paths or modules most affected.
- **Implementation notes:** decisions, constraints, deviations from a plan, follow-ups, verification performed.
```

---

## 2026-11-24: Removed Data Settings, Add Certification and in-app ingestion

- **Feature / change:** Implemented [implementation-plans/remove-data-settings-and-exam-ingestion.md](implementation-plans/remove-data-settings-and-exam-ingestion.md) ahead of the portal demo.
- **What was completed:**
  - Removed the Data Settings page, the Add Certification page, the in-app ingestion pipeline (PDF, website, OCR, JSON, job worker), the upload API route, the draft-editing actions and components, and the `ingest:worker` script. `/c/<slug>/data` and `/certifications/new` now return 404 for everyone; the home page shows only active certifications with a published version.
  - Exam Coverage & Quality stays, administrators only, with all eight tabs, now strictly read-only and published-version only: `loadDraftQuality` was replaced by `loadPublishedQuality`, which throws for draft, review and archived versions; the page ignores `?version=`.
  - Preserved learner features, `/api/pdf`, `/api/exhibit`, the offline `scripts/import-db.ts`, and the exam-guide verifier (its PDF helper moved to `scripts/pdf_extract.py`).
- **Important files / areas:** `lib/quality.ts`, `lib/actions.ts`, `lib/cert.ts`, `app/(portal)/c/[cert]/data-quality/page.tsx`, `app/(portal)/(home)/page.tsx`, `components/sidebar.tsx`, `next.config.ts`, `package.json`, `.env.example`, `tests/e2e/`.
- **Implementation notes:**
  - No schema change, no migration and no database write. `IngestionJob` and `UploadedFile` remain in both schemas with their data.
  - Verified locally (SQLite and PGlite only): tsc, eslint, next build, Vitest on SQLite (148 passed) and on PostgreSQL via PGlite (145 passed, 3 skipped), Playwright e2e (25 passed), and the exam-weight verifier smoke test (PASS).
  - `docs/INGESTION.md` is kept as an archived description of the removed system.

## 2026-11-21: Questions & Review, learner source abstraction, Exam Coverage & Quality

- **Feature / change:** Implemented [implementation-plans/exam-guide-mapping.md](implementation-plans/exam-guide-mapping.md) (revision 2), phases 0 to 6.
- **What was completed:**
  - One "Questions & Review" sidebar group (All, Marked for Review, Flagged, Incorrect, Bookmarks). The Common and per-source pages are removed and their URLs redirect to All Questions.
  - Learners receive no original source identity anywhere: neutral "Source" / "Source 1…N" labels and claim kinds, no source URLs, pages, topic labels, notes or asset paths in page data; source filters, sorts and search ignored; `/api/pdf` admin-only; exhibits through the new `/api/exhibit`; question export without source columns; personal backup format v4 with neutral references (v1 to v3 still restore as before). Administrators keep full provenance.
  - Data Quality became the administrator-only **Exam Coverage & Quality** page, with a new Overview: Blueprint Distribution Alignment (gated by `BLUEPRINT_VERIFIED_WEIGHTS`), weight vs. share, domain table, separate question-quality card, and neutral per-source table.
  - Slim learner Exam Blueprint (official weights, objectives, considerations; no personal stats or score), sharing `components/blueprint-share.tsx` with the admin page.
  - Read-only weight verifier `scripts/verify-exam-weights.ts`; production PMLE weights verified (pass) on 2026-11-21.
- **Important files / areas:** `lib/blueprint.ts`, `lib/exhibits.ts`, `lib/question-data.ts`, `lib/filters.ts`, `lib/questions.ts`, `lib/progress-io.ts`, `lib/quality.ts`, `components/sidebar.tsx`, `components/question-card.tsx`, `components/blueprint-share.tsx`, `components/distribution-card.tsx`, `app/(portal)/c/[cert]/data-quality/page.tsx`, `app/(portal)/c/[cert]/blueprint/page.tsx`, `app/api/exhibit/route.ts`, `app/api/pdf/route.ts`, `app/api/export/questions/route.ts`, `next.config.ts`.
- **Implementation notes:**
  - No schema change and no migration. No production data was written; the production checks ran in a read-only session.
  - Production configuration still to do: set `BLUEPRINT_VERIFIED_WEIGHTS` to the verified entry; until then the score reads "unavailable".
  - Verified with tsc, eslint, next build, Vitest on SQLite (224 passed) and on PostgreSQL via PGlite (221 passed, 3 skipped), Playwright e2e (23 passed). Deviations are listed in the plan.

## 2026-11-20: Documentation baseline established

- **Feature / change:** Created the `docs/` documentation set for the existing application.
- **What was completed:**
  - Investigated the code (structure, frontend, server actions and routes, schema and migrations, auth, ingestion, exam logic, configuration, tests, existing docs) and recorded the application as it is, without redesign.
  - Added `docs/README.md` (guide and maintenance rules), `docs/CURRENT_STATE.md`, `docs/architecture/DATABASE.md`, `docs/architecture/SYSTEM_ARCHITECTURE.md`, `docs/DEVELOPMENT_LOG.md` and `docs/implementation-plans/README.md`.
  - Recorded known limitations and documentation inconsistencies in `CURRENT_STATE.md` section 17.
- **Important files / areas:** `docs/` only. No source, schema, migration or configuration files were changed by this task.
- **Implementation notes:**
  - This entry is a baseline; it does not reconstruct earlier history. Earlier work, such as the move of production data to Neon PostgreSQL, the explicit Start-processing ingestion flow and the Data Settings / Data Quality redesign (all verified 2026-11-05), is described in `CURRENT_STATE.md` as present behaviour. Older release notes remain in `PROGRESS.md` (partly stale).
  - Existing guides `docs/DEPLOYMENT.md` and `docs/INGESTION.md` were left unchanged and are linked from `docs/README.md`.
  - Statements were checked against source files; items that could not be checked (production host, live behaviour beyond the 2026-11-05 verification, headless-browser stage in production, `pg_dump` against Neon) are marked unverified in the documents.
