# Deploying PMLE Prep for your company

This guide covers running the portal for many employees: one shared question bank, separate progress per person, sign-in by company email, and backups you can recover from.

## 1. What you need to decide and provide

None of these can be created by the app. They are your choices and your credentials.

| Item | Why | Notes |
|---|---|---|
| **Managed PostgreSQL** | Production database: survives restarts, redeploys and server replacement | Any Postgres 14+ works: Cloud SQL, AlloyDB, Amazon RDS, Azure Database, Neon, Supabase and so on. Turn on automated backups and point-in-time recovery (PITR). |
| **`DATABASE_URL`** | Connection string, stored in the host's secret manager | `postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require`. Add `&pgbouncer=true` if it goes through a transaction-mode pooler. |
| **`ALLOWED_EMAIL_DOMAINS`** | Who can sign in | For example `yourcompany.com`. In production nobody can sign in until this is set. |
| **`ADMIN_EMAILS`** | Who can use admin tools | Admins can take database snapshots and edit shared data-quality decisions (duplicates, answer resolutions, classification). Everyone else sees those pages read-only. |
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
- **Data model.**
  - **Shared by everyone:** questions, sources, answer verification, theory concepts, and admin decisions.
  - **Personal** (each row has a `userId`, a foreign key and a cascade delete): attempts, flags, notes, theory progress, practice and mock sessions, plan ticks, settings, and the last visited page.
- **Saving.**
  - Clicks such as answers, flags, checkboxes and settings choices save straight away. Typing (notes, numbers) saves 0.8 seconds after you stop, and also when you leave the page.
  - Changes go into a per-user outbox in the browser, which also survives in `localStorage` until the server confirms them. The outbox merges rapid changes, retries with backoff when the network or server is down, and pauses with a "sign in again" link if the session has expired.
  - Each change carries the time it was made. The server ignores a write that is older than what it already holds, so a late or retried request can never overwrite newer data, even from another tab or device.
  - Other open tabs refresh themselves after a save.
  - A status indicator in the sidebar shows saving, saved, offline or error.
  - The database is the source of truth. `localStorage` only holds unsent changes.

## 3. First deployment (PostgreSQL)

Run these from the `pmle-prep` folder, with production `DATABASE_URL`, `ALLOWED_EMAIL_DOMAINS` and `ADMIN_EMAILS` set in the environment.

```bash
npm ci                 # postinstall generates the PostgreSQL Prisma client because DATABASE_URL starts with postgresql://
npm run db:migrate     # applies prisma/postgres/migrations
npm run build          # regenerates the client for the same provider, then runs next build
```

Then load the data, using **one** of the two options below.

- **Option A: fresh bank.** Run `npm run ingest:db`. It imports `data/processed/bank.json` and can be re-run safely.
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

- **Deploying a new version:** run `npm ci && npm run db:migrate && npm run build`, then restart. Migrations only add to the schema and never drop user data.
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

  Questions are referenced by stable source keys, so a backup still works after the bank is reimported.
- **Restore from a backup** (Settings) validates the file and *merges* it into the signed-in account only.
  - It never deletes anything, and importing the same file twice adds nothing.
  - It rejects files that aren't PMLE Prep exports.
  - It accepts older version 1 exports.
- These files are a convenience, not a substitute for database backups.

## 7. Security checklist

- [ ] HTTPS in front of the app. Cookies become `Secure` automatically when the proxy sends `X-Forwarded-Proto: https`. Set `COOKIE_SECURE=true` if it doesn't.
- [ ] `ALLOWED_EMAIL_DOMAINS` and `ADMIN_EMAILS` are set. `.env` is not committed, and secrets live in the host's secret manager.
- [ ] Network-level access control or an identity-aware proxy is in place, if email-only sign-in isn't enough for you (see section 1).
- [ ] The database is not publicly reachable, or requires TLS and a strong password, and the app's database user has only the access it needs.
- [ ] Provider backups and PITR are on, and a restore has been tested.
- [ ] Uptime monitoring checks `/api/health`.

## 8. Local development

Nothing changes from before: `DATABASE_URL="file:../data/pmle.db"`, then `npm run setup` and `npm run dev`.

- With `ALLOWED_EMAIL_DOMAINS` unset (or `"*"`), any email works locally.
- Open a private window to test as a second user.
- `npm test` runs unit and integration tests on throwaway SQLite files.
- `npm run test:e2e` runs browser tests against a production build.
- To run the integration suite on PostgreSQL, set `TEST_PG_URL` (see section 4).
