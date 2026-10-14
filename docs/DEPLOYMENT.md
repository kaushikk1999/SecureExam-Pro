# Deployment and operations

## Provisioning

1. Use a supported managed PostgreSQL release in an appropriate region. Use the provider's pooled TLS connection URL. Keep migration/owner credentials separate from runtime credentials. Apply `npm run db:migrate` to an empty production database; never run the demo seed there. Vercel production builds also apply pending migrations before building the app, so the production database credentials used at build time must be allowed to run schema migrations.
2. Create a runtime role with SELECT/INSERT/UPDATE on operational tables and sequences. For `audit_events`, allow SELECT/INSERT only, never UPDATE/DELETE/TRUNCATE. The trigger is defense in depth, not protection against a database owner. Use the migration role only for schema administration.
3. Generate `AUTH_SECRET` privately. Set both app URLs to the exact HTTPS production origin. Set `DATABASE_PROVIDER=postgres` (or omit it; PostgreSQL is the default).
4. Provision the administrator through `npm run admin:create`. Enable and test TOTP before requiring it. The TOTP encryption key is distinct from the cookie signing secret. Backup loss of this key prevents decoding enrolled secrets.
5. In Vercel, connect this source directory, keep the Next.js framework preset, use Node.js 22+, run `npm ci` and `npm run build`. The build copies the Monaco runtime to `public/monaco`, so editor code does not depend on a third-party CDN.
6. Provision a private Vercel Blob store and set `BLOB_READ_WRITE_TOKEN` for document workflows. The handler accepts files up to 4 MB to stay below request body limits. It validates type/extension, common signatures, ownership and size. Add institutional malware scanning before allowing untrusted Office content at scale; files are never executed by this server.
7. Exam deletion records cloud file cleanup in PostgreSQL before removing the exam and results. Cleanup is attempted immediately, then retried daily by `/api/cron/storage-cleanup` using `CRON_SECRET`. Vercel Hobby permits daily schedules; failures remain queued and visible to the authenticated cleanup endpoint. The separate deadline sweeper is not scheduled on Hobby: attempt writes enforce the deadline and instructor monitoring finalizes expired attempts. For more frequent unattended deadline finalization, configure an external scheduler for `/api/cron` with `CRON_SECRET`.
8. Smoke-test authentication, role isolation, course-scoped exam visibility, enrollment/removal, a classroom practice exam, draft saving and expiry on the deployed origin before involving real students.

Production PostgreSQL is provisioned through Neon. Vercel Blob, Google Sheets, and Ollama remain optional integrations and are not configured here. Add an initial administrator and Google OAuth credentials before inviting exam users.

## Google Sheets

Create a `SecureExam` tab, share the spreadsheet with the service-account email, and set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` and `GOOGLE_SHEET_ID`. The exam report action appends a batch using RAW values. Repeating the action appends another snapshot; it is not a continuous replication service. Heartbeats, answers and authentication stay in PostgreSQL.

## Ollama

Set `OLLAMA_ENABLED=true`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL` (default `gemma3:4b`), and optionally `OLLAMA_API_KEY`. A Vercel function cannot reach your laptop's localhost; supply an authenticated HTTPS gateway reachable from the deployment. Only teacher-entered draft requests are sent. Do not send sensitive student records without institutional approval.

## Capacity and recovery

The Vercel Node.js function uses Fluid compute in Singapore (`sin1`) and each application instance pools up to five PostgreSQL connections. Production Neon uses a pooled connection in Singapore (`ap-southeast-1`), keeping database round trips close to the function and Bangkok students. Vercel scales function capacity with demand, but the database connection and compute limits remain the practical ceiling.

The integration suite simulates 100 verified BU Google identities at once, saves student IDs, enrolls them through the course QR flow, starts the same exam, loads each attempt and saves answers concurrently. This verifies application concurrency and data isolation against an isolated PostgreSQL-compatible test database; it does not benchmark the production Neon plan, Google OAuth's external rate limits, or real classroom devices. Before a high-stakes cohort, run a staged load test against a Neon branch with the same compute and pooling configuration as production. For example, 100 active students polling every ten seconds generate approximately 10 read requests per second, before heartbeat/autosave traffic. Autosave is debounced and location samples are throttled. Paginate/archive long-lived operational data as cohort size grows.

Take encrypted backups, test restoration, and export signed/hash-verified audit checkpoints outside the primary database. `npm run audit:verify` checks internal chains. A database administrator can rewrite a whole chain; external checkpoints and operational access controls are necessary for independent evidence.

If the database is unavailable, exam edits remain queued locally when browser storage is available. Changes arriving after the authoritative deadline are not silently accepted. Preserve the student's local draft for instructor review. Never extend an exam by changing the student's system clock.

Pause stops answer acceptance and warnings. Resume adds the paused interval to deadlines. Closing/archiving submits active attempts. Reopening and re-entry are separate, audited controls: reopen grants a new time interval; re-entry authorizes binding to a new server-issued device ID.

## Retention

Do not enable unreviewed deletion of dispute evidence. The configured day count records institutional intent and is displayed in the consent notice. This version does not execute automated evidence purges. Establish archival, appeal holds, approved deletion, backup expiry and access procedures before production use with sensitive data.
