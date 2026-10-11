# Google login and university integrations

## Enable normal Google login

1. In Google Cloud, configure the OAuth consent screen and create a **Web application** OAuth client. If the consent screen is in testing mode, add the intended test users.
2. Register the exact redirect URI `http://localhost:3000/api/auth/callback/google` for local development. For deployment, also register `https://YOUR_DOMAIN/api/auth/callback/google`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the private server environment. Keep them out of source control and chat. Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the actual app origin.
4. Restart the server (redeploy for production). **Continue with Google** appears on the login page when both credentials are configured. The administrator's University integrations page shows the configuration status without exposing secrets.
5. Verified Bangkok University student Google Workspace accounts (`@bumail.net`) can register as students on first sign-in. `@bu.ac.th` is the university's staff Microsoft 365 domain; use the matching Google Workspace account for Google sign-in. To allow additional verified Google Workspace domains, set `GOOGLE_AUTO_PROVISION_DOMAINS` to a comma-separated allowlist. To grant teacher access at first sign-in, add only approved exact addresses to `GOOGLE_TEACHER_EMAILS`; never allowlist a whole domain as teachers. Existing accounts keep their current roles, and Google sign-in never creates admins. A different Google subject cannot silently replace an existing mapping.

Google-managed email means a verified `gmail.com` address or an email whose domain matches Google's verified `hd` claim. Other addresses used to create a Google account are not automatically linked; use the existing credentials login or an administrator-approved OIDC mapping. Local accounts requiring an authenticator continue using password + OTP: Google login does not bypass local MFA. When `REQUIRE_TEACHER_MFA=true`, teachers also need to enroll in local MFA before signing in.

Configured is not the same as verified: live acceptance requires signing in through the institution's OAuth client. Implementation follows [Google's OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect) and the installed NextAuth v4 provider.

## Optional custom university OpenID Connect

Set `SSO_ISSUER`, `SSO_CLIENT_ID`, and `SSO_CLIENT_SECRET`; the issuer must exactly match the provider's ID-token issuer and expose its discovery endpoint. Register `/api/auth/callback/university`. An administrator links an existing local email to the provider's exact subject in University integrations. Custom OIDC does not link by email alone. PKCE, state, nonce, issuer, audience and token signature checks are handled by NextAuth/OpenID Client.

If local MFA is configured or teacher MFA is mandatory, the ID token must include `SSO_REQUIRED_AMR` (default `mfa`) in its `amr` list. Verify the provider's actual claim policy before enabling access. Mapping changes revoke the affected user's current application sessions. See [NextAuth's OAuth provider configuration](https://next-auth.js.org/configuration/providers/oauth).

## Deployment and rollback

Run `npm run db:migrate` before starting the new build. Migration 005 is additive. Keep a normal database backup for production deployment. To roll back application code, restore the prior source/build; the additional tables can remain, preserving practice and appeal history. The local pre-expansion source archive is `.data/backups/before-expansion.tar.gz`; it is a code snapshot, not a database backup.
