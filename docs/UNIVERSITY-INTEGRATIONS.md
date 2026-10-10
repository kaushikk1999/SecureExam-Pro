# Google login and university integrations

## Enable normal Google login

1. In Google Cloud, configure the OAuth consent screen and create a **Web application** OAuth client. If the consent screen is in testing mode, add the intended test users.
2. Register the exact redirect URI `http://localhost:3000/api/auth/callback/google` for local development. For deployment, also register `https://YOUR_DOMAIN/api/auth/callback/google`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the private server environment. Keep them out of source control and chat. Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the actual app origin.
4. Restart the server (redeploy for production). **Continue with Google** appears on the login page when both credentials are configured. The administrator's University integrations page shows the configuration status without exposing secrets.
5. Create/enroll the local student account first, using the same Gmail or Google Workspace email. The first verified Google login binds the provider's stable subject to that existing account. No public account creation or role promotion occurs. A different Google subject cannot silently replace an existing mapping.

Google-managed email means a verified `gmail.com` address or an email whose domain matches Google's verified `hd` claim. Other addresses used to create a Google account are not automatically linked; use the existing credentials login or an administrator-approved OIDC mapping. Local accounts requiring an authenticator continue using password + OTP: Google login does not bypass local MFA.

Configured is not the same as verified: live acceptance requires signing in through the institution's OAuth client. Implementation follows [Google's OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect) and the installed NextAuth v4 provider.

## Optional custom university OpenID Connect

Set `SSO_ISSUER`, `SSO_CLIENT_ID`, and `SSO_CLIENT_SECRET`; the issuer must exactly match the provider's ID-token issuer and expose its discovery endpoint. Register `/api/auth/callback/university`. An administrator links an existing local email to the provider's exact subject in University integrations. Custom OIDC does not link by email alone. PKCE, state, nonce, issuer, audience and token signature checks are handled by NextAuth/OpenID Client.

If local MFA is configured or teacher MFA is mandatory, the ID token must include `SSO_REQUIRED_AMR` (default `mfa`) in its `amr` list. Verify the provider's actual claim policy before enabling access. Mapping changes revoke the affected user's current application sessions. See [NextAuth's OAuth provider configuration](https://next-auth.js.org/configuration/providers/oauth).

## Optional Canvas LMS

Canvas was selected as the initial adapter; no university Canvas instance is connected by default. Set `CANVAS_BASE_URL` to its HTTPS origin (no path) and `CANVAS_ACCESS_TOKEN` to a server-side token with the required enrollment-read and submission-grade permissions. Only administrators can configure mappings or run synchronization.

1. Map a local course to a Canvas course ID.
2. Preview its roster. Active StudentEnrollment entries must expose a usable email/login ID. The preview shows existing-account enrollments and new student accounts. Review every entry, then confirm within 15 minutes. Data is fetched again and changes invalidate the preview.
3. Imports add student accounts and enrollments atomically, preserving existing roles, account names, passwords, disabled status and eligibility. They never remove enrollments. Imported new accounts have an unknown random password: use verified Google login, explicit SSO mapping or the existing administrator password-setting workflow. Importing accounts does not email credentials.
4. Map a local exam to a Canvas assignment ID within that mapped course. Release grades locally first.
5. Preview grade synchronization. Each batch contains at most 20 completed attempts. Choose starting record 0, then the displayed next starting record for subsequent batches. Unmapped students and incompletely graded attempts are explicitly skipped. Verify skipped records and repeat from a fresh preview after correcting them.
6. Confirm the reviewed changes. Each write sends the absolute percentage earned, without silently clamping negative marks. The server rechecks the grade and result-release status before each write. Canvas controls whether its own grades are posted to students according to its assignment policy.
7. Inspect Sync history. Partial failures are reported per student. Retry by creating a new preview; absolute grade writes and enrollment uniqueness make repeated sends safe. A process interrupted while RUNNING retains completed grade-write results; preview again after checking the history. Large institutions should deploy a durable job runner before increasing the bounded batch sizes.

Roster pagination is bounded at 20 pages of 100 records. Foreign-origin pagination URLs and redirects are rejected so the Canvas token is not forwarded elsewhere. No existing role or student eligibility is changed, and no official exam attempt is created by import.

API references: [Canvas enrollments](https://developerdocs.instructure.com/services/canvas/resources/enrollments) and [Canvas submissions](https://developerdocs.instructure.com/services/canvas/resources/submissions).

## Deployment and rollback

Run `npm run db:migrate` before starting the new build. Migration 005 is additive. Keep a normal database backup for production deployment. To roll back application code, restore the prior source/build; the additional tables can remain, preserving practice and appeal history. The local pre-expansion source archive is `.data/backups/before-expansion.tar.gz`; it is a code snapshot, not a database backup.
