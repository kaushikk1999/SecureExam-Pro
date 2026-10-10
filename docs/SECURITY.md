# Security model and review notes

## Authority and isolation

Role, account status and session version are read from PostgreSQL for every API operation. Roles never come from browser request bodies. Privileged operations additionally check course/exam ownership. Students cannot list the question bank, read another student's attempt, set grades, change configuration or access private audit trails. Attempt responses explicitly project safe question fields and suppress grades/feedback until release. Hidden answer keys/rubrics are never serialized for students.

Session cookies use NextAuth's HttpOnly/SameSite behavior and secure flags on HTTPS. Credentials are bcrypt-hashed. Login rate limits are database-backed per normalized account identifier; deploy an edge/IP rate limiter as an additional credential-stuffing defense. Vercel rejects local `.test` demonstration accounts. Session-version changes revoke all devices. TOTP uses encrypted secrets and atomic replay-step updates; institution-managed recovery is an operator procedure, not a public bypass.

Mutations require matching Origin. Authentication has NextAuth CSRF protection. GET does not perform explicit administrative mutations; deadline reconciliation can finalize an expired attempt during a read. Zod bounds input sizes and enums, SQL is parameterized, React escapes text, and Markdown does not enable raw HTML. CSP, frame restrictions, MIME sniffing prevention and permissions policies are set in `next.config.ts`. The current CSP allows framework inline scripts; it is not a nonce-only policy.

## Examination integrity

- Server-issued device IDs, bound to account/session version, are registered before entry. Same-attempt foreign IDs are rejected. Device identity remains a browser token, not hardware attestation.
- A unique student/exam constraint and partial active-attempt index enforce attempt restrictions.
- Deadlines are persisted once. The visible clock uses a server time anchor and `performance.now`; only the server decides whether an answer can be accepted.
- Saves, event receipts, warnings and submission run under an attempt row lock. Answer versions prevent late retry overwrites, and revisions preserve accepted history.
- A batch saves answers before processing its warning events. Events carry UUID idempotency keys; overlapping warning events have a ten-second server debounce.
- Student reconnects retry queued data. Late offline edits are not silently counted as submitted. Local drafts may contain sensitive answers: use managed devices and clear them according to institution policy after resolution.
- Pauses, extensions, re-entry, resets, grading and incident annotations append audit events.

## Proctoring interpretation

Camera/microphone permission and live tracks are checked in the browser. Stream end and sustained mute events are reported. The server cannot independently prove a webcam is live or that client telemetry has not been tampered with. There is no face recognition, person detection, gaze scoring, emotion inference, audio transcription or raw recording.

Location uses haversine distance and reported accuracy. Before entry, an inaccurate or outside location is rejected with a corrective message. During the exam, a warning needs consecutive accurate readings that are clearly outside even after accounting for uncertainty. Accepted samples are at least 15 seconds apart. Poor accuracy, inability to obtain location and network interruption are recorded without warning escalation.

Fullscreen, page visibility and window focus are observations, not physical locks. One browser action may fire several events, which are debounced. Assistive technologies can trigger focus changes; warning/device exemptions and extra time are teacher configurable.

A student can use another physical device, photograph the display, spoof geolocation, modify client code or suppress telemetry. Browser controls cannot prevent these reliably. Use classroom supervision and institutional procedures where stronger assurance is required.

## Files and integrations

Private Blob URLs remain server side. Download/preview requests verify ownership or examination access. PDF/image previews are inline; TXT/DOCX text is extracted within bounded limits. Office originals are not executed. Hiding download controls cannot prevent an authorized browser from saving material it can render. A file signature check is not antivirus.

Ollama is an optional drafting aid; its output must be reviewed. It cannot assign penalties, determine cheating, or change grades. Sheets receives explicit report batches only. Integration credentials stay in server environment variables.

## Audit evidence

Every audit event hashes its previous event plus canonical event content. Chains are serialized with advisory transaction locks. A trigger denies ordinary audit updates/deletes. Corrections append new events referencing old ones. Internal hash-chain verification catches changes and missing links but cannot independently detect rewriting an entire chain or deleting a tail by a privileged database owner. Anchor export digests externally for stronger evidence.

## Dependency review

Runtime dependencies are checked with `npm audit --omit=dev`. During development, the installed Next.js lint toolchain reports the upstream `braces` recursion advisory (five transitive high-severity entries). The reported registry version has no patched compatible release at this time. It processes repository glob patterns during linting, not student inputs in the deployed runtime. Do not downgrade Next.js to an obsolete major solely to silence that toolchain report. Recheck before deployment and update when a compatible fix is released.
