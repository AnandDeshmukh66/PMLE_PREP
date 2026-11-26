# Documentation guide

Entry point for the project documentation. Read this first, then `CURRENT_STATE.md`.

## Documents and their single responsibilities

| Document | Answers | Nature |
|---|---|---|
| [CURRENT_STATE.md](CURRENT_STATE.md) | What exists today, what works, what is partial or missing? | Current-application reference. Overwritten as the app changes; not a history. |
| [architecture/DATABASE.md](architecture/DATABASE.md) | How is data structured, related and kept consistent? | Architecture. Changes only when schema, constraints, relationships or data-access approach change. |
| [architecture/SYSTEM_ARCHITECTURE.md](architecture/SYSTEM_ARCHITECTURE.md) | How do the parts work together (request flow, auth, workflows, background work, runtime)? | Architecture. Changes only when structure, major workflows, integrations or communication patterns change. |
| [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) | What meaningful work was completed, and when? | Append-only history. |
| [implementation-plans/](implementation-plans/README.md) | What is being built, how, and how far along is it? | One Markdown plan per significant feature, updated during implementation. |

Operational guides that predate this structure and remain valid (they are detailed references, not duplicated here):

- [DEPLOYMENT.md](DEPLOYMENT.md): hosting, PostgreSQL/Neon setup, backups and recovery, security checklist.
- [INGESTION.md](INGESTION.md): **archived**; describes the in-app ingestion system removed on 2026-11-24 (kept as history).

Other files outside `docs/`: `README.md` (learner-oriented project introduction), `PROGRESS.md` (older release checklist, partly stale; see "Known documentation inconsistencies" in CURRENT_STATE.md), `AGENTS.md` (Next.js agent notice written by `next dev`).

## Where things go

- Describing what the app does now: `CURRENT_STATE.md`.
- A schema change (model, field, index, constraint, migration approach): `architecture/DATABASE.md`.
- A change to request flow, auth, ingestion/exam workflows, integrations, background processing, deployment shape: `architecture/SYSTEM_ARCHITECTURE.md`.
- Planning a feature: a new file in `implementation-plans/` (see its README for the template and naming).
- Recording a finished feature: a new entry at the top of the log in `DEVELOPMENT_LOG.md`.

## Maintenance rules

These rules are permanent. Follow them whenever you change the application.

1. **`CURRENT_STATE.md` represents the current application, not its history.** Update it when functionality is added, removed or changed, or when an architectural or workflow change alters the real state of the app. Do not append every code change, bug fix or minor adjustment.
2. **Architecture documentation is updated when architecture changes.** Update `DATABASE.md` when the schema, relationships, constraints or data-access approach change. Update `SYSTEM_ARCHITECTURE.md` when system structure, major workflows, integrations or communication patterns change. Do not touch them for cosmetic or minor code changes.
3. **The development log records meaningful completed work.** After finishing a meaningful feature or significant change, add a short entry. Do not log every commit or small adjustment.
4. **Implementation plans track implementation progress.** Keep phase statuses current, mark completed phases, and record deviations from the plan. When the whole feature is implemented and verified, update `CURRENT_STATE.md` and `DEVELOPMENT_LOG.md`.
5. **Do not duplicate documentation.** Each file has one responsibility (table above). Cross-reference instead of copying sections.
6. **Code is the source of truth.** If documentation and code disagree, the code wins: correct the documentation, and do not assume the code is wrong. If you cannot confirm a statement from the code, write "unverified" rather than guessing.

Additional conventions used in these documents:

- Feature status labels in `CURRENT_STATE.md`: **Working** (implemented and exercised by tests or manual verification), **Partial** (implemented with stated gaps), **Unverified** (code exists but was not exercised or integrated), **Missing** (not implemented).
- File paths are relative to the application root (the folder containing `package.json`, `pmle-prep/`).
- Never put secrets, connection strings, tokens or access codes in documentation. Name the environment variable instead.
- Statements about live data (row counts, versions) carry the date they were verified.
