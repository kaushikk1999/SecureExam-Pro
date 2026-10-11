# Verification report

Verified locally on 9 October 2026, against the finished optimized Next.js production server and local PostgreSQL 18. The application is configured for Vercel, but has not been deployed.

| Check | Result |
| --- | --- |
| Development server / HTTP response | Passed, HTTP 200 |
| `npm run build` | Passed, optimized production compilation and route generation |
| `npm run start` | Passed, production application serves on localhost:3000 |
| `npm run typecheck` | Passed, TypeScript strict mode |
| `npm run lint` | Passed |
| `npm test` | 34 passed: 14 domain tests + 20 PostgreSQL-compatible API/integration tests |
| `npm run test:e2e` | 3 passed on the optimized production server, approximately 53 seconds |
| `npm audit --omit=dev` | Zero runtime vulnerabilities |
| Frontend secret scan | 18 generated frontend files checked against private environment values, zero matches |
| `npm run audit:verify` | All checked event chains valid; zero integrity failures |
| Responsive inspection | Desktop 1440px and mobile 390px screenshots inspected; no horizontal page overflow |

## Database/API coverage

- Unauthenticated rejection, student denial on teacher APIs, authorized teacher access, foreign-origin mutation rejection.
- Safe exam projections before entry, hidden answer keys/rubrics/grades, cross-student attempt isolation and denial of student grading.
- Before-start and after-close rejection, geofence entry rejection, idempotent entry and duplicate device control.
- Server deadline persistence across reads and rejection of client clock authority.
- Versioned autosave, stale-version rejection, duplicate concurrent event deduplication and overlapping-event debounce.
- Inaccurate GPS readings produce no warning; consecutive accurate outside readings produce a warning.
- Fifth-warning submission, answer locking, idempotent submission, immutable audit trigger and audited moderation.
- Authenticated cron expiry of an offline attempt.
- CSV export through an authorized teacher endpoint.

The API tests use isolated PGlite databases running PostgreSQL semantics; actual browser tests use the normal `pg`/Drizzle driver connected to the local PostgreSQL process.

## Browser scenarios

1. **Teacher:** sign-in → overview → create draft → attach a question → publish → audit page → mobile layout. Desktop and mobile screenshots are saved in `.data`.
2. **Student:** sign-in → teacher API denied → preflight → answer MCQ → autosave → load/type in locally hosted Monaco → refresh → recover saved answer → confirm submission → locked receipt.
3. **Strict exam:** teacher creates a strict exam and test student → simulated camera/microphone/geolocation checks → server-issued room code → fullscreen entry → answer → accelerated browser ten-minute location checkpoint → five simulated focus events separated by real server debounce intervals → automatic submission → teacher sees submitted status and five warning events → teacher grades → XLSX download succeeds.

Test 3 uses Chromium simulated devices/location and synthetic browser focus events. It validates software behavior and database outcomes, not a claim that real campus hardware, actual room boundaries, or all OS switching paths have been validated. The application contains no test-only authorization bypass.

## Visual artifacts

- `.data/dashboard-desktop.png`
- `.data/dashboard-mobile.png`
- `.data/exam-screen.png`

These contain only locally generated demonstration data. No password fields or private credentials were captured.

## Unverified external services and operational limits

- Production PostgreSQL provider, TLS connection/pool sizing, limited runtime role and backup restoration.
- Private Vercel Blob upload/streaming, real Office/PDF rendering across browsers, and institutional malware scanning.
- Google service-account authorization and Sheet destination.
- Ollama network gateway and model availability.
- Deployed HTTPS/cookie behavior, real TOTP provisioning/recovery and production cron scheduling.
- Physical webcam/microphone devices, browser permission revocation, campus indoor GPS, approved assistive technologies and full-cohort load.
- Automatic retention purging is not implemented; the configurable retention period is an institutional policy/disclosure setting. See SECURITY.md and DEPLOYMENT.md.
- Face/person detection, raw recording, QR check-in, email delivery, OCR and automated code execution are not enabled. They are not represented as functioning controls.

The development-only lint dependency tree has five transitive high-severity entries for an upstream braces recursion advisory with no compatible patched version reported by the registry. This is separate from the clean production dependency audit and is documented in SECURITY.md.

## Feature expansion — 10 October 2026

The additive 005 migration was applied to local PostgreSQL. The optimized application is running on localhost:3000. The existing exam lifecycle code was preserved; the new endpoints share its origin, session and rate-limit boundary.

| Check | Expansion result |
| --- | --- |
| Production build | Passed |
| TypeScript and ESLint | Passed |
| Server/domain tests | 50 passed (34 existing + 16 expansion tests) |
| Browser scenarios | All 6 verified across the suite and targeted reruns |
| New browser flows | Practice device checks/save/read-back/reload; learning and appeals navigation; instructor action center/analytics/integrations; student appeal → instructor decision → student history → warning review |
| Existing browser flows | Author/publish/mobile; real answer autosave/refresh/submission; simulated strict devices/location/checkpoint/fifth-warning submission |
| Frontend secret scan | 22 generated frontend JS/CSS files, zero matches for configured private values |
| Audit verification | Zero integrity failures after extension and browser workflows |
| Visual review | Desktop and 390px mobile practice layouts inspected; no horizontal overflow; warning forms collapsed for scanability |

The additional tests cover practice isolation and stale saves, grade-release gating and student privacy, teacher course isolation, removed LMS route rejection, issuer/subject ownership, Google verified-email binding and MFA restrictions, expired-session filtering, incident review uniqueness and appeal version transitions/reopening.

Two browser test selectors were corrected for persistent local data and Next.js's accessibility route announcer. Repeated verification logins hit the existing login rate limit; only the local seeded teacher's test throttle record was reset before the targeted rerun. No application security threshold was weakened.

Google and custom university OpenID Connect provider credentials are environment-specific; real provider acceptance must be checked against the configured production providers. Canvas integration has been removed from the application. Ordinary credentials login continues to work.
