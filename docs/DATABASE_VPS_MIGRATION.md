# Moving TalentOS from Neon to the self-hosted Postgres

TalentOS' database moved from Neon (reached over HTTP) to PostgreSQL 17.11 on a
private VPS (`40.160.139.188:5432`, database `talentos`). This is what changed,
what is verified, and the two steps that remain.

## What the code does now

`src/server/db/neon.ts` — still named that because 361 modules import it as
`@/server/db/neon`, and renaming would churn all of them for no functional gain —
now **picks its driver from the connection string**:

| connection string | driver |
| --- | --- |
| `*.neon.tech` | `@neondatabase/serverless` over HTTP |
| anything else | `node-postgres` over TCP |

So switching databases is a change to one secret, and **rolling back is the same
change in reverse**. No application code knows which database it is talking to.

Its public API is unchanged (`query`, `queryOne`, `execute`, `sql`,
`testConnection`), including the `sql` tagged-template and both
`sql.transaction()` shapes that `finalizationService.ts` and the AI routing admin
routes rely on. `testConnection()` additionally reports which driver is live.

One improvement fell out of the move: the TCP driver gives **real transactions**.
`PUT /api/admin/ai-automations/[id]/routes` previously did a DELETE followed by
loose INSERTs with no atomicity — a comment in that file explained it had no
choice, because the HTTP driver could not open a transaction — so a failed INSERT
could leave an automation with partial or zero routes. It is now one
BEGIN/COMMIT.

## Production must go through Hyperdrive

This is not a preference. A Worker **cannot** connect directly to this server:

- The server presents a **self-signed certificate**. `pg-cloudflare` calls
  `startTls({ secureTransport: "starttls" })`, and Cloudflare's socket API accepts
  no CA and offers no way to skip verification, so TLS fails outright.
- Even with a valid certificate, a Worker may not reuse a socket across requests,
  so every unit of work would pay a fresh handshake — **measured at ~4 seconds** to
  this host.

Hyperdrive solves both: it connects from Cloudflare's network and pools
connections to the origin. `worker-entry.mjs` copies
`env.HYPERDRIVE.connectionString` into `process.env.DATABASE_URL`, so the database
module needs no runtime-specific lookup. If the binding is missing, the module
logs an explicit one-line explanation rather than failing obscurely.

### Remaining step 1 — create the Hyperdrive config

```bash
npx wrangler hyperdrive create talentos-pg \
  --connection-string="postgresql://postgres_admin:PASSWORD@40.160.139.188:5432/talentos?sslmode=require"
```

Then paste the printed id into the `[[hyperdrive]]` block in `wrangler.toml` and
uncomment it. The credentials live inside Cloudflare, not in the repo.

### Remaining step 2 — flip the secret

Set the GitHub secret `TALENTOS_DATABASE_URL` to the VPS connection string. It
feeds the Worker secret, the CI migration step, and the scheduled jobs.

Because production is still writing to Neon until that happens, **re-check for
rows Neon received in the meantime** before considering the cutover done:
`scripts/reconcile-job-duplicates.mts` is safe to re-run, and a table-by-table
row-count diff is the quickest integrity check (it was 123/123 identical at
migration time).

## TLS, honestly

`sslmode=require` means different things in different clients, and that difference
caused the first connection failures here:

- **libpq / psql** — encrypt, do not verify. Works against this server, which is
  why the CI migration step needs no change.
- **node-postgres** — modern `pg-connection-string` treats `require` as
  `verify-full`, which rejects a self-signed certificate.

So the driver strips `sslmode` from the URL and configures TLS explicitly:
encrypted (confirmed TLSv1.3 against the server) but not CA-verified. That is the
strongest setting this server currently supports, and far better than the
alternative of disabling TLS, which would put the password on the wire in clear
text.

**Worth doing:** install a CA-issued certificate (point a hostname at the VPS and
use Let's Encrypt). Then `rejectUnauthorized` can be turned back on and the
connection becomes fully verified. Until then, an attacker who can intercept the
route could in principle present their own certificate.

**Also worth doing:** rotate the `postgres_admin` password. It was shared in
plain text over chat, so it should be treated as exposed. It is only stored in
gitignored `.env.local` (with the old Neon URL preserved in
`.env.neon-backup.local`), never committed.

## Scripts

`scripts/lib/db.mjs` is the shared connection helper for standalone scripts, and
picks its driver the same way. `reconcile-job-duplicates.mts` and
`backfill-canonical-job-fingerprints.mts` use it.

**Roughly thirty other scripts still construct `new Client()` from
`@neondatabase/serverless` directly.** Those only ever worked against Neon and
will fail against the VPS. Most are one-off migration helpers. Porting one is a
two-line change: import `getDbClient` from the helper and delete the driver
import. They are left as-is rather than bulk-edited blind, since many are
single-use and untested.

While porting the reconcile script its query was also narrowed: it used to select
`description_text` for every row in the 15-day window (~5,000 rows, tens of
megabytes), which was tolerable over Neon's HTTP transport and is not over a
remote TCP link. It now fetches that column only for the minority of rows that
need it.

## Verified

- **Data migration**: 123/123 tables present, **identical row counts on every
  one**, nothing missing or extra.
- **Driver**, live against the VPS: `query` / `queryOne` / `execute` with
  `rowCount`, tagged templates, both `transaction()` shapes, and
  **rollback-on-failure** (a duplicate-key transaction left no rows behind).
- `npx tsc --noEmit` clean; **82 test files / 633 tests pass**.
- `scripts/reconcile-job-duplicates.mts` runs end to end against the VPS.

## Not verified

- **A full `next build` was not run to completion** — it takes over ten minutes on
  this project and was cut short. The one issue it did surface (`pg-native`
  unresolved) is fixed via a `next.config.mjs` alias, and it was a warning, not an
  error: the build had already moved past type-checking into page-data collection.
  Run `npm run build` before deploying.
- **No Worker deploy was exercised.** The Hyperdrive path is reasoned from
  Cloudflare's documented socket behaviour and `pg-cloudflare`'s source, not from
  a live Worker request. Test it in preview before trusting production.
- Query latency measured from a development machine is dominated by that
  machine's distance to the host (~360 ms/round-trip) and says nothing useful
  about production, where Hyperdrive pools connections inside Cloudflare's
  network.
