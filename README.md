# SecureExam Pro

A Next.js examination workspace for Bangkok University, with PostgreSQL as the authoritative store. Teacher and student workflows are implemented, with role and ownership checks on every protected API. Browser monitoring produces reviewable evidence, never a misconduct verdict.

## 1. Application status

- Next.js 16.4 / React 19 / strict TypeScript application, with a working local PostgreSQL database.
- Development server and optimized production build verified locally.
- Automated verification and its limits are documented in [docs/VERIFICATION.md](docs/VERIFICATION.md).
- Vercel configuration is included. No cloud deployment has been performed.
- Private file storage, Google Sheets and Ollama are disabled gracefully until configured.
- Expansion: isolated practice/readiness, instructor action center, student learning, question analytics and incident appeals are available in role-specific workspace navigation.
- Google login and optional custom OIDC/Canvas integrations are implemented but require provider credentials. See [system design](docs/EXPANSION-DESIGN.md) and [integration setup](docs/UNIVERSITY-INTEGRATIONS.md).

## 2. Architecture

| Layer | Implementation |
| --- | --- |
| Frontend | Next.js App Router, React, responsive custom component system, reduced-motion CSS, Lucide, Markdown/GFM/LaTeX, locally hosted Monaco |
| Backend | Node.js route handlers, Zod input schemas, origin validation, per-user rate limiting |
| Database | PostgreSQL + Drizzle parameterized SQL and numbered transactional migrations |
| Authentication | NextAuth encrypted session cookies, bcrypt, database role/active/session-version validation; encrypted TOTP secrets and replay protection |
| Live updates | Authenticated HTTPS polling: teacher 3 seconds, student 5 seconds, heartbeat 15 seconds; PostgreSQL remains authoritative |
| Storage | Private Vercel Blob, authenticated streaming, bounded file sizes and content checks |
| Proctoring | Browser focus/fullscreen/device events, 30-second location samples, fresh 10-minute checkpoints, accuracy checks, consecutive outside readings |
| AI | Optional server-side Ollama draft endpoint; no autonomous misconduct decisions |
| Sheets | Optional service-account batch export; never used for transactional data |

Polling is intentional: it works within Vercel request lifecycles without maintaining unsupported long-running socket servers. Alerts are near-real-time, with roughly three-second teacher latency. Load-test your anticipated classroom size against the database pool and deployment plan.

## 3. Project structure

```text
src/app/                         landing, login, protected workspace and exam pages
src/app/api/auth/                session authentication
src/app/api/platform/[...path]/  validated and authorized application APIs
src/app/api/cron/                authenticated deadline sweeper
src/components/workspace.tsx     teacher tools and student portal
src/components/exam-room.tsx     preflight, device monitoring, answer queue and timer
src/lib/auth.ts                  RBAC, account/session validation, TOTP
src/lib/exams.ts                 transactional examination engine
src/lib/domain.ts                geofencing, grading, policies, hashing
src/lib/audit.ts                 chained audit events and database rate limits
src/lib/integrations.ts          Ollama and Google Sheets
migrations/                     versioned PostgreSQL schema
scripts/                        migration, seed, admin bootstrap, audit verification
public/monaco/                  generated local editor runtime (not committed)
tests/                          domain, API/database and browser tests
docs/                           security, deployment and verification notes
```

## 4. Database

`users` owns authentication and student profile data. `courses` belongs to a teacher, and `enrollments` assigns students. `classrooms` stores geofence configurations; each exam snapshots its selected classroom and policy. `questions` belong to a teacher; `exam_questions` assembles the paper. `attempts` fixes question and choice order and records deadlines, warnings, device state and final submission state.

`answers` contains the latest response and mark; `answer_revisions` preserves autosave history. `exam_devices` stores server-issued device session IDs. `event_receipts` deduplicates telemetry. `accommodations` grants individual exemptions/extra time. `checkins` manages approval. `files` stores private asset references and safe text previews. `notifications` delivers instructor messages. `settings` stores institution branding. `audit_events` is hash-chained and protected by a mutation-denying trigger. `rate_limits` and `schema_migrations` support operations.

A unique constraint prevents duplicate student IDs and duplicate student/exam attempts. A partial unique index permits only one active exam per student. Attempt row locks serialize saves, warnings, grading transitions and submission. The server rejects edits after expiry regardless of the browser clock.

## 5. Environment variables

Copy [.env.example](.env.example). Never commit `.env`, database files, exports containing real student records, or service credentials. No client environment variable contains credentials. The only public URL is the application origin.

Required production settings: `DATABASE_PROVIDER=postgres`, `DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`. Use a strong random secret, and HTTPS public URLs with exactly the same origin.

Optional: `BLOB_READ_WRITE_TOKEN`; `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`; `OLLAMA_ENABLED`, `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, `OLLAMA_MODEL`; `MFA_ENCRYPTION_KEY`, `REQUIRE_TEACHER_MFA`.

`SEED_PASSWORD` is local-only. Bootstrap variables are one-time administrator provisioning inputs and must be removed afterward.

## 6. Local running

Node.js 22 or newer is recommended.

```bash
npm ci
cp .env.example .env
```

Set `AUTH_SECRET`, `CRON_SECRET` and `SEED_PASSWORD` privately to different cryptographically random values (at least 32, 32 and 16 characters respectively). Leave `DATABASE_URL` empty if using the included local runner.

Terminal 1:

```bash
npm run db:local
```

This starts PostgreSQL on **127.0.0.1:55432**, stores its cluster inside `.data/postgres`, and writes randomly generated local connection credentials into `.env`. It never opens a database port to the network. Keep this process running. Alternatively, configure an existing PostgreSQL database and skip the runner.

Terminal 2:

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. Local accounts: `teacher@example.test` (administrator) and `student1@example.test` through `student6@example.test`. Their development password is the value **you set privately** in `SEED_PASSWORD`. No universal password exists. The seed refuses production/Vercel execution, and Vercel rejects `.test` account sign-in.

The prepared workspace already has a private `.env` and local seed data. Do not overwrite it when continuing this workspace. Stop the local database with Ctrl+C after stopping the application.

PGlite is retained only for isolated automated tests. Do not use an embedded PGlite data directory across Next.js worker processes or hot reloads.

## 7. Testing

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run browsers:install
# With the application and local database running:
npm run test:e2e
npm run audit:verify
npm audit --omit=dev
```

Browser tests create clearly named test examinations in the local seed database. Run them only against development data. Simulated devices/geolocation exercise browser code; they are not a substitute for classroom hardware validation. The strict test takes approximately one minute because it respects the server warning debounce window.

## 8. Vercel deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The included `vercel.json` configures Node route handlers and an authenticated once-per-minute expiry sweeper. This schedule requires a Vercel plan that supports the frequency; use a supported external scheduler if necessary.

Use a new managed PostgreSQL database, apply migrations with a provisioning credential, bootstrap the administrator, then supply a limited application credential to Vercel. Do not copy the local seeded database to production. Blob must be a **private** store. AI and Sheets are optional.

```bash
npx vercel link
npx vercel env add DATABASE_URL production
npx vercel env add AUTH_SECRET production
npx vercel env add NEXTAUTH_URL production
npx vercel env add NEXT_PUBLIC_APP_URL production
npx vercel env add CRON_SECRET production
# Add optional integration variables as needed, then:
npx vercel --prod
```

These commands have not been executed. Do not deploy until production service configuration and the institutional review in the deployment guide are complete.

## 9. Teacher / administrator setup

Set `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, and a unique `BOOTSTRAP_ADMIN_PASSWORD` (16+ characters) privately in the operator environment, then run:

```bash
npm run admin:create
```

Set `BOOTSTRAP_ROLE=TEACHER` to provision a teacher instead of an administrator. There is no public teacher registration or client-controlled role assignment. Provisioning is an operator-only command. For TOTP, provision an authenticator with a Base32 secret using your institutional process, supply that secret as `BOOTSTRAP_MFA_SECRET`, and set a strong `MFA_ENCRYPTION_KEY`. Set `REQUIRE_TEACHER_MFA=true` to refuse privileged accounts without TOTP. The application encrypts the secret at rest and rejects reused time steps. Remove all bootstrap variables afterward. Back up the encryption key securely.

Students are created/imported from the teacher workspace. CSV headers are `email,name,studentId,section,password`; passwords must be at least 12 characters. Resetting access revokes all current sessions. Account deactivation and logout-all-devices are server enforced.

## 10. Demonstration flow

1. Sign in as the local teacher. Create a course, add/import students, and create a classroom with campus-verified coordinates.
2. Create a draft exam, select a security preset, set dates and duration, add question-bank entries, and publish.
3. Open live monitoring and display the rotating room code if required.
4. Sign in as a student in a separate browser context. Complete device/location checks, accept the monitoring notice, enter the room code and request approval if enabled.
5. Begin via the fullscreen user gesture, answer questions and observe autosave. Refresh and resume with the same server deadline and saved answers.
6. In a **test examination**, exercise browser visibility and fullscreen controls. One action is debounced on client and server. At the configured limit, the server saves the current batch, submits and locks the attempt.
7. Inspect teacher monitoring and evidence, annotate or waive a warning, and grade manual questions. Release results when ready.
8. Export attendance/results to CSV or XLSX, print to PDF, or batch sync to a configured Google Sheet.

Tests and their exact coverage are listed in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## 11. Browser limitations and privacy

See [docs/SECURITY.md](docs/SECURITY.md). Browser signals are untrusted observations. Fullscreen can be exited; geolocation can be spoofed; another camera or device, screenshots, OS shortcuts and modified browser code cannot be reliably blocked. Indoor location cannot reliably distinguish floors. Missing/low-accuracy readings are evidence for review, not automatic cheating findings.

Raw camera/microphone recordings are never uploaded. No facial identity, sensitive attribute, gaze, emotional, or personality inference is implemented. Face/person counting and audio conversation analysis are intentionally not enabled without a validated, accessible local model. Coding responses are manually graded; arbitrary student code is never executed.

The retention setting is a policy/disclosure setting, not an automatic destructive deletion job. Immutable dispute evidence must be archived/deleted through an institution-approved privileged process, including backups. Do not promise automatic deletion at the configured day count. QR check-in, email delivery, automated code execution, image OCR, and AI-driven paper conversion are not enabled; rotating numeric codes, browser alerts, manual grading, document previews and editable AI drafts cover the corresponding core workflows.

## 12. Quality gate

The repository includes checks for RBAC and cross-student isolation, exam windows/geofences, duplicate sessions/events, immutable audit history, autosave version conflicts, server-authoritative expiry, warning-limit submission, manual moderation, and exports. A production build is verified, and responsive screenshots were inspected.

Remaining external validation: managed PostgreSQL connectivity/permissions, private Blob upload/download, Ollama gateway, Sheets service account, production HTTPS/MFA provisioning, and campus hardware/GPS/accessibility testing. A successful local build does not establish institutional compliance or guarantee cheating prevention.
