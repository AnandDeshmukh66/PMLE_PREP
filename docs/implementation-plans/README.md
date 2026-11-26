# Implementation plans

This folder holds one plan per **significant** feature or change. Add one only when real work is about to start (see [../README.md](../README.md), rule 4).

| Plan | Status |
|---|---|
| [exam-guide-mapping.md](exam-guide-mapping.md): Questions & Review consolidation, learner source abstraction, Exam Coverage & Quality | Completed 2026-11-21 |
| [remove-data-settings-and-exam-ingestion.md](remove-data-settings-and-exam-ingestion.md): removal of Data Settings, Add Certification and in-app exam ingestion; Exam Coverage & Quality kept read-only and published-only | Completed 2026-11-24 |

## When to write a plan

Write a plan when a change touches several areas (schema, server logic, UI, ingestion), needs more than one working session, or carries data or behaviour risk. Do not write plans for small fixes or speculative ideas.

## File naming

`NNNN-short-kebab-title.md`, numbered in creation order (for example `0001-exam-guide-ingestion.md`). One feature per file.

## Template

```markdown
# <Feature name>

- Status: Proposed | In progress | Completed | Abandoned
- Owner / last updated: <name>, YYYY-MM-DD

## Objective
What problem this solves and for whom, in a few sentences.

## Existing behavior
What the application does today in this area, with file paths. Link to CURRENT_STATE.md sections instead of copying them.

## Requirements and acceptance criteria
- Requirement 1, with a testable acceptance criterion
- ...

## Affected files and areas
Paths and modules expected to change.

## Database changes
Models, fields, constraints, migration approach for BOTH providers (prisma/migrations and prisma/postgres/migrations), data backfill, rollback. Write "None" if none.

## Implementation phases
| Phase | Scope | Status (Not started / In progress / Done / Dropped) | Notes |
|---|---|---|---|

## Testing
Unit, integration and e2e tests to add or change; manual checks; which database providers are exercised.

## Risks
What could go wrong, including data safety, and the mitigation.

## Deviations
Dated list of departures from this plan and why. Empty at the start.
```

## Keeping plans current

- Update phase statuses as work progresses; record every deviation in **Deviations** when it happens.
- When all phases are done and verified: set Status to Completed, update `../CURRENT_STATE.md` (and `../architecture/*` if structure, schema or workflows changed), and add an entry to `../DEVELOPMENT_LOG.md`.
- Keep completed plans in this folder as the record of intent. Do not copy their content into other documents; link to them.
- Abandoned plans stay with Status `Abandoned` and a one-line reason.
