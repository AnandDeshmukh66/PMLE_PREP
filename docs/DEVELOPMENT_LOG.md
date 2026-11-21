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
