# Deploying PMLE Prep for your company

This guide covers running the portal for many employees: one or more certifications (PMLE first) with shared, versioned question banks, separate progress per person, sign-in by company email, and backups you can recover from. Content ingestion is described in [INGESTION.md](INGESTION.md).

## 1. What you need to decide and provide

None of these can be created by the app. They are your choices and your credentials.

| Item | Why | Notes |
|---|---|---|
| **Managed PostgreSQL** | Production database: survives restarts, redeploys and server replacement | The recommended choice is **Neon** (the free tier is enough; see section 3). Any Postgres 14+ works: Cloud SQL, AlloyDB, Amazon RDS, Azure Database, Supabase and so on. Turn on backups and point-in-time recovery (PITR) where your plan offers them. |
| **`DATABASE_URL`** | Connection string for queries, stored in the host's secret manager | Neon: the **pooled** string (host contains `-pooler`) plus `&connect_timeout=15`, without `pgbouncer=true` (Neon's pooler supports prepared statements, and the flag made queries noticeably slower). Others: `postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require`. To use a schema other than `public`, add `&schema=NAME` to both URLs. |
| **`DIRECT_URL`** | Connection string for migrations only | Neon: the **direct** string (no `-pooler`). Optional elsewhere; it defaults to `DATABASE_URL`. |
| **`ALLOWED_EMAIL_DOMAINS`** | Who can sign in | For example `yourcompany.com`. In production nobody can sign in until this is set. |
| **`ADMIN_EMAILS`** | Who can use admin tools | Admins add certifications, create and publish content versions, run ingestion, edit data-quality decisions and take database snapshots. Everyone else never sees drafts and sees data-quality pages read-only. |
| **`ADMIN_ACCESS_CODE`** | Second factor for admin actions | A shared secret of 8 or more characters (for example `openssl rand -base64 24`). A listed admin must enter it once per session (valid `ADMIN_ELEVATION_HOURS`, default 8) before any admin action. Because sign-in is by email only, **admin actions are disabled in production until this is set.** Five wrong codes in 15 minutes lock the account out for that window. |
| **Hosting with HTTPS** | Runs `next start` | Any Node.js 20.9+ host: a VM, Cloud Run, App Engine flexible environment, Render, Fly.io, Kubernetes and so on. Put it behind HTTPS so session cookies are `Secure`. |
| **Network access policy** | Email-only sign-in is *identification*, not strong authentication | Anyone who knows a colleague's address could sign in as them. Keep the site on the company network or VPN, or behind an identity-aware proxy (for example Google IAP or Cloudflare Access), if progress data matters. |

The app uses no paid APIs. The only costs are the hosting and the database you choose.

## 2. How the pieces fit

- **Sign-in.** A user enters a company email. The account is created on first sign-in and found again afterwards, with the email lower-cased.
  - The server sets a random session token in an `httpOnly`, `SameSite=Lax` cookie, which is `Secure` over HTTPS. Only a SHA-256 hash of the token is stored, in the `AuthSession` table.
  - Sessions slide: they stay valid for `SESSION_TTL_DAYS` (default 30) after the last use.
  - Logging out deletes the session row.
  - Sign-in attempts are rate-limited per IP address.
- **Authorization.**
  - `proxy.ts` sends anonymous visitors to `/login`.
  - Every page, server action and API route then looks up the user on the server (`requireUser` / `apiUser`).
  - Every query on personal data filters by that user's ID. User IDs are never accepted from the browser.
  - Admin actions check on the server that the email is in `ADMIN_EMAILS` **and** that the session was unlocked with `ADMIN_ACCESS_CODE`. Certification, version, ingestion-job and access-code events (including failed codes) are written to the `AuditEvent` table.
  - Learners can only read published and archived content versions. A draft or a version in review returns "not found" to them, on pages and in server actions.
- **Certifications and versions.**
  - After sign-in, users land on the certification home (`/`), which shows each certification's latest published version and their progress. Each certification lives under `/c/<code>/…`. Old PMLE links such as `/questions/…` redirect to `/c/pmle/…`.
  - Content is versioned: `draft` → `review` → `published` → `archived`. Published versions never change; a correction is a new draft. Publishing a new version archives the old one, gives learners fresh progress on it, and keeps their old progress viewable. See [INGESTION.md](INGESTION.md), section 1.
  - A certification added through **Add Certification** stays a draft, invisible to learners, until an admin publishes a version.
- **Data model.**
  - **Shared by everyone:** certifications, content versions, questions, sources, answer verification, exam domains and objectives, theory concepts, ingestion jobs, and admin decisions. Questions, objectives and concepts belong to exactly one version.
  - **Personal** (each row has a `userId`, a foreign key and a cascade delete): attempts, flags, notes, theory progress, practice and mock sessions, plan ticks, settings, and the last visited page. Theory progress and plan ticks are kept per version.
- **Saving.**
  - Clicks such as answers, flags, checkboxes and settings choices save straight away. Typing (notes, numbers) saves 0.8 seconds after you stop, and also when you leave the page.
  - Changes go into a per-user outbox in the browser, which also survives in `localStorage` until the server confirms them. The outbox merges rapid changes, retries with backoff when the network or server is down, and pauses with a "sign in again" link if the session has expired.
  - Each change carries the time it was made. The server ignores a write that is older than what it already holds, so a late or retried request can never overwrite newer data, even from another tab or device.
  - Other open tabs refresh themselves after a save.
  - A status indicator in the sidebar shows saving, saved, offline or error.
  - The database is the source of truth. `localStorage` only holds unsent changes.

## 3. First deployment (PostgreSQL)

### Setting up Neon (free tier)

These steps happen in your own Neon account. The app can't do them for you, and it never needs your Neon password anywhere except in these two environment variables.

1. Sign up at [neon.tech](https://neon.tech) and create a project. Pick the region closest to where the app runs. The free plan needs no payment details.
2. In the project's **Connect** dialog, choose your database and role, then copy two connection strings:
   - with **Connection pooling** on: this is `DATABASE_URL`. Its host contains `-pooler`. Add `&connect_timeout=15` after `?sslmode=require` (not `pgbouncer=true`).
   - with **Connection pooling** off: this is `DIRECT_URL`. Add `&connect_timeout=15`.
3. Put both in your host's secret manager, or in `.env` on a machine you control. Never commit them; `.env` is gitignored.
4. Run the commands below. `npm run db:migrate` uses `DIRECT_URL`, and the app uses `DATABASE_URL`.

Free-tier compute sleeps when idle. The first request after a pause takes a second or two to wake it, which is what `connect_timeout=15` is for. Neon keeps a short restore window on the free plan; take your own snapshots too (section 6).

### Commands

Run these from the `pmle-prep` folder, with production `DATABASE_URL`, `DIRECT_URL`, `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS` and `ADMIN_ACCESS_CODE` set in the environment.

```bash
npm ci                 # postinstall generates the PostgreSQL Prisma client because DATABASE_URL starts with postgresql://
npm run db:migrate     # applies prisma/postgres/migrations
npm run build          # regenerates the client for the same provider, then runs next build
```

Then load the data, using **one** of the two options below.

- **Option A: fresh bank.** Run `npm run ingest:db -- --publish`. It imports `data/processed/bank.json` as the PMLE version and publishes it. Without `--publish`, the version stays a draft for an admin to review. It can be re-run safely: an unchanged bank is skipped.
- **Option B: carry over your local database**, which includes the bank, your data-quality decisions and existing progress:

  ```bash
  npm run claim-local-progress -- you@yourcompany.com   # locally first, with the SQLite DATABASE_URL (see section 5)
  DATABASE_URL="postgresql://..." npm run db:copy-to-postgres -- --from data/pmle.db
  ```

  This needs Node.js 22.13 or newer. It opens the SQLite file read-only, refuses to write into a database that already has rows, copies every table in one transaction, resets ID sequences and compares row counts at the end.

Start the server with `npm run start`, which honours `PORT`. The health check endpoint is `GET /api/health`: it returns 200 when the database is reachable and 503 when it isn't.

Deploy these files with the app: `data/processed/bank.json` (needed by `ingest:db`) and `data/raw/pdf/ML_Engineer_Exam_Questions.pdf` (served to the in-app PDF links). The PDF view simply reports "not found" if the PDF is missing.

**Several instances.** Everything is stored in Postgres, so you can run more than one instance. The sign-in rate limiter is per instance.

**Building in CI.** The Prisma client is generated for whichever provider `DATABASE_URL` points to at build time, so the build step needs a `postgresql://` value. Any syntactically valid URL is enough; the build does not connect to it.

## 4. Upgrades and schema changes

- **Deploying a new version:** run `npm ci && npm run db:migrate && npm run build`, then restart. Migrations only add to the schema and never drop user data. Take a snapshot first (`npm run backup`, or a Neon branch).
- **Upgrading to multi-certification** (migration `20261105090000_multi_certification`):
  - The migration creates the PMLE certification (`cert_pmle`) and its published version 2026 (`ver_pmle_2026`), and attaches every existing question, source, objective, concept and review decision to that version.
  - Question IDs, attempt IDs and all progress are kept as they are. Theory progress and plan ticks get the version ID.
  - Afterwards, run `npm run ingest:db` once. It finds the bank unchanged and records the version's content fingerprint.
  - On the real SQLite database, row counts before and after were identical, and the SQLite integrity and foreign-key checks passed.
- **Correcting content:** never edit a published version. In Data Settings, create a new draft (empty, or copied from an existing version), make the fixes or run ingestion into it, then submit and publish.
- **Changing `prisma/schema.prisma`** (developers only):
  1. Create the SQLite migration: `npm run db:migrate:dev -- --name my_change`.
  2. Regenerate the Postgres schema: `npm run db:sync-schema`.
  3. Write the matching PostgreSQL migration against a scratch Postgres database, using its URL as the shadow database:

     ```bash
     mkdir prisma/postgres/migrations/$(date +%Y%m%d%H%M%S)_my_change
     npx prisma migrate diff --from-migrations prisma/postgres/migrations --to-schema-datamodel prisma/postgres/schema.prisma \
       --shadow-database-url "postgresql://...scratch..." --script > prisma/postgres/migrations/<that folder>/migration.sql
     ```

  4. Run the integration suite against Postgres: `TEST_PG_URL=postgresql://...scratch... npx vitest run tests/integration`. Generate the Postgres client first by running `npm run db:generate` with that URL.

## 5. Moving existing single-user progress

Upgrading the database (`npm run db:migrate`) does not delete progress recorded before sign-in existed. It moves it to a placeholder account called `legacy-local-user`. To give it to a real person, run this once:

```bash
npm run claim-local-progress -- you@yourcompany.com
```

The command does the following:

- Moves every attempt, flag, note, theory item, session, plan tick and setting to that email, creating the account if needed.
- If the account already has data, keeps the newer flag or theory status and keeps the account's existing settings and plan ticks.
- Removes the placeholder.
- Does nothing if there is nothing to claim.

You can also do this per person: export from the old install (Settings → Download My Backup), then sign in on the new site and use Settings → Restore from a backup.

## 6. Backups and recovery

Continuous saving protects you against lost clicks, refreshes and flaky networks. **Backups** protect against losing the database itself, bad deployments and operator mistakes. You need both.

### Database-level (operators)

| | PostgreSQL (production) | SQLite (single machine) |
|---|---|---|
| Primary | Your provider's automated daily backups plus point-in-time recovery. Set retention to at least 7 days, preferably 30. | Built-in scheduler: every `BACKUP_INTERVAL_HOURS` (default 24) it writes a consistent `VACUUM INTO` snapshot to `BACKUP_DIR`. |
| Extra copies | `BACKUP_INTERVAL_HOURS=24` makes the app run `pg_dump --format=custom` into `BACKUP_DIR`, or you can run it from cron (below). `pg_dump` must be installed and at least as new as the server. | Copy `BACKUP_DIR` off the machine regularly. |
| Retention | `BACKUP_KEEP` (default 14) newest files are always kept. Older files are deleted after `BACKUP_RETENTION_DAYS` (default 30). | Same. |
| On demand | Admins: Settings → Snapshot to BACKUP_DIR, or Download database snapshot. CLI: `npm run backup`. | Same. |

Here is a cron example for a separate machine with `pg_dump`. Upload the files to storage with versioning or a retention lock, such as a Cloud Storage or S3 bucket:

```cron
15 2 * * *  pg_dump --format=custom --no-owner "$PG_URL" > /backups/pmle-$(date +\%F).dump && find /backups -name 'pmle-*.dump' -mtime +30 -delete
```

The scheduler only runs while the server process is up. On scale-to-zero hosts, rely on the provider's backups or cron instead.

**Restore procedures**

- **PostgreSQL, PITR:** restore to a new instance at a time just before the incident, point `DATABASE_URL` at it, and restart.
- **PostgreSQL, from a dump:**
  1. Create an empty database.
  2. Run `pg_restore --no-owner --dbname "$NEW_URL" pmle-....dump`.
  3. Run `npm run db:migrate` (a no-op if the dump is current).
  4. Switch `DATABASE_URL` and restart.
- **SQLite:**
  1. Stop the server.
  2. Move `data/pmle.db` aside; don't delete it.
  3. Copy the snapshot to `data/pmle.db`.
  4. Start the server.
- **After any restore,** open `/api/health`, sign in, and check a few users' dashboards.

Test a restore into a scratch database at least once before you rely on it.

### Personal backups (every user)

- **Download My Backup** (Settings) downloads a JSON file to the user's computer. It contains:
  - the account email and settings
  - every attempt
  - flags, notes and theory progress
  - practice and mock sessions, including in-progress answers and position
  - plan ticks
  - answer resolutions

  Questions are referenced by content version, question code and neutral source references (`#<n>:<number>`, format version 4), so a backup still works after the bank is reimported and names no original source. It covers every certification version the user has worked on.
- **Restore from a backup** (Settings) validates the file and *merges* it into the signed-in account only.
  - It never deletes anything, and importing the same file twice adds nothing.
  - It rejects files that aren't PMLE Prep exports.
  - It accepts older version 1 and 2 exports, which are applied to the PMLE 2026 version, and version 3 exports (raw source keys), which restore exactly as before.
  - Version 4 files are not accepted by deployments older than 2026-11-21; restore them on a current deployment.
- These files are a convenience, not a substitute for database backups.

## 7. Security checklist

- [ ] HTTPS in front of the app. Cookies become `Secure` automatically when the proxy sends `X-Forwarded-Proto: https`. Set `COOKIE_SECURE=true` if it doesn't.
- [ ] `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS` and `ADMIN_ACCESS_CODE` are set. `.env` is not committed, and secrets (including both database URLs) live in the host's secret manager. None of them are `NEXT_PUBLIC_` variables, so they never reach the browser.
- [ ] If ingestion runs on this host, it can reach only the public internet it needs. Private addresses are already refused by the app.
- [ ] Network-level access control or an identity-aware proxy is in place, if email-only sign-in isn't enough for you (see section 1).
- [ ] The database is not publicly reachable, or requires TLS and a strong password, and the app's database user has only the access it needs.
- [ ] Provider backups and PITR are on, and a restore has been tested.
- [ ] Uptime monitoring checks `/api/health`.
- [ ] Before showing the Blueprint Distribution Alignment score for a content version: run `npx tsx scripts/verify-exam-weights.ts --live --cert <slug>` against the production database through a read-only path (it only reads), record the result in the plan's verification log, and only on PASS set `BLUEPRINT_VERIFIED_WEIGHTS` to the printed entry. On a mismatch, change nothing and investigate.
- [ ] After each release, sign in as a learner and view the page source of a question page: no original source names, URLs or file names. As an administrator, confirm the provenance panel still shows them.

## 8. Local development

Nothing changes from before: `DATABASE_URL="file:../data/pmle.db"`, then `npm run setup` and `npm run dev`.

- With `ALLOWED_EMAIL_DOMAINS` unset (or `"*"`), any email works locally.
- Open a private window to test as a second user.
- `npm test` runs unit and integration tests on throwaway SQLite files.
- `npm run test:e2e` runs browser tests against a production build.
- To run the integration suite on PostgreSQL, set `TEST_PG_URL` (see section 4). A free local option is PGlite: `npx pglite-server --port=55432 --db=/tmp/pglite-data`, then `TEST_PG_URL="postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable&connection_limit=1&pgbouncer=true" npx vitest run tests/integration --no-file-parallelism` (generate the Postgres client with that URL first, and run `npm run db:generate` afterwards to switch back to SQLite).
- Locally, with `ADMIN_ACCESS_CODE` unset, listed admins aren't asked for a code. Set it to test the production behaviour.
