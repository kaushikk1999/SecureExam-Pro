import Google from "next-auth/providers/google";
import { resolveGoogleIdentity, resolveUniversityIdentity } from "./sso";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { sql } from "drizzle-orm";
import { TOTP, Secret } from "otpauth";
import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { query } from "./db";
import { rateLimit, record } from "./audit";
import { ensureDefaultCoursesForUser } from "./course-provisioning";
import { isStudentEmailAllowed } from "./auth-role";
export function decryptSecret(value: string) {
  const [iv, tag, data] = value.split(".");
  const key = createHash("sha256")
    .update(process.env.MFA_ENCRYPTION_KEY ?? "")
    .digest();
  const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "hex")),
    cipher.final(),
  ]).toString();
}
export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 3600 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            checks: ["pkce", "state", "nonce"],
          }),
        ]
      : []),
    ...(process.env.SSO_ISSUER?.startsWith("https://") &&
    process.env.SSO_CLIENT_ID &&
    process.env.SSO_CLIENT_SECRET
      ? [
          {
            id: "university",
            name: "University SSO",
            type: "oauth" as const,
            wellKnown:
              process.env.SSO_ISSUER.replace(/\/$/, "") +
              "/.well-known/openid-configuration",
            issuer: process.env.SSO_ISSUER,
            clientId: process.env.SSO_CLIENT_ID,
            clientSecret: process.env.SSO_CLIENT_SECRET,
            authorization: { params: { scope: "openid profile email" } },
            idToken: true,
            checks: ["pkce", "state", "nonce"] as (
              "pkce" | "state" | "nonce"
            )[],
            profile(profile: { sub: string; name?: string; email?: string }) {
              return {
                id: profile.sub,
                name: profile.name ?? "University user",
                email: profile.email ?? null,
              };
            },
          },
        ]
      : []),
    Credentials({
      name: "University account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        otp: { label: "Authenticator code", type: "text" },
      },
      async authorize(credentials, req) {
        const email = String(credentials?.email ?? "")
          .toLowerCase()
          .trim();
        if (
          !email ||
          email.length > 254 ||
          String(credentials?.password ?? "").length > 128
        )
          return null;
        const allowed = await rateLimit("login:" + email, 8, 300);
        const [u] = await query(sql`SELECT * FROM users WHERE email=${email}`);
        // Compare a valid dummy hash as well, reducing account-enumeration timing differences.
        let ok = Boolean(
          allowed &&
          (await compare(
            credentials?.password ?? "",
            u?.password_hash ??
              "$2b$12$C6UzMDM.H6dfI/f/IKcEe.9yTTt7vwAibdBo3wfDOPQdlTCpHF9Ya",
          )) &&
          u?.active &&
          (u.role !== "STUDENT" || isStudentEmailAllowed(u.email)),
        );
        if (process.env.VERCEL && email.endsWith(".test")) ok = false;
        if (ok && u.mfa_secret) {
          const totp = new TOTP({
            secret: Secret.fromBase32(decryptSecret(u.mfa_secret)),
          });
          const delta = totp.validate({
            token: credentials?.otp ?? "",
            window: 1,
          });
          const step = Math.floor(Date.now() / 30000) + (delta ?? 0);
          if (delta === null) ok = false;
          else {
            const accepted = await query(
              sql`UPDATE users SET mfa_last_step=${step} WHERE id=${u.id} AND (mfa_last_step IS NULL OR mfa_last_step<${step}) RETURNING id`,
            );
            ok = accepted.length === 1;
          }
        }
        if (
          ok &&
          u.role !== "STUDENT" &&
          process.env.REQUIRE_TEACHER_MFA === "true" &&
          !u.mfa_secret
        )
          ok = false;
        await record({
          userId: u?.id,
          type: ok ? "LOGIN_SUCCESS" : "LOGIN_FAILED",
          severity: ok ? "INFO" : "LOW",
          metadata: {
            sessionId: ok ? randomUUID() : null,
            role: u?.role ?? null,
            browser: /Edg\//.test(String(req.headers?.["user-agent"]))
              ? "Edge"
              : /Firefox\//.test(String(req.headers?.["user-agent"]))
                ? "Firefox"
                : /Chrome\//.test(String(req.headers?.["user-agent"]))
                  ? "Chrome"
                  : /Safari\//.test(String(req.headers?.["user-agent"]))
                    ? "Safari"
                    : "Other",
            operatingSystem: /Windows/.test(String(req.headers?.["user-agent"]))
              ? "Windows"
              : /Mac/.test(String(req.headers?.["user-agent"]))
                ? "macOS"
                : /Android/.test(String(req.headers?.["user-agent"]))
                  ? "Android"
                  : /Linux/.test(String(req.headers?.["user-agent"]))
                    ? "Linux"
                    : "Other",
            deviceType: /Mobile|Android|iPhone|iPad/.test(
              String(req.headers?.["user-agent"]),
            )
              ? "mobile/tablet"
              : "desktop/laptop",

            reason: ok
              ? "authenticated"
              : allowed
                ? "invalid credentials or MFA"
                : "rate limited",
            userAgent: String(req.headers?.["user-agent"] ?? "").slice(0, 300),
          },
        });
        if (!ok) return null;
        await query(sql`UPDATE users SET last_login=now() WHERE id=${u.id}`);
        await ensureDefaultCoursesForUser({
          id: u.id,
          email: u.email,
          role: u.role,
        });
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          version: u.session_version,
          role: u.role,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || !["university", "google"].includes(account.provider))
        return true;
      const local =
        account.provider === "google"
          ? await resolveGoogleIdentity(
              profile as Record<string, unknown> | undefined,
            )
          : await resolveUniversityIdentity(
              profile as Record<string, unknown> | undefined,
            );
      if (!local) return false;
      Object.assign(user, {
        id: local.id,
        name: local.name,
        email: local.email,
        version: local.session_version,
        role: local.role,
      });
      await query(sql`UPDATE users SET last_login=now() WHERE id=${local.id}`);
      await ensureDefaultCoursesForUser({
        id: local.id,
        email: local.email,
        role: local.role,
      });
      await record({
        userId: local.id,
        type: "SSO_LOGIN_SUCCESS",
        metadata: { provider: account.provider },
      });
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.version = (user as unknown as { version: number }).version;
        token.role = (user as unknown as { role: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as unknown as { id: string; version: number }).id =
          String(token.uid);
        (session.user as unknown as { version: number }).version = Number(
          token.version,
        );
        (session.user as unknown as { role: string }).role = String(
          token.role ?? "",
        );
      }
      return session;
    },
  },
};
export type Actor = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "TEACHER" | "STUDENT";
  student_id: string | null;
};
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function actor(roles?: Actor["role"][]): Promise<Actor> {
  const s = await getServerSession(authOptions);
  const u = s?.user as unknown as { id: string; version: number } | undefined;
  if (!u) throw new HttpError(401, "Please sign in.");
  const [row] = await query(
    sql`SELECT id,name,email,role,student_id FROM users WHERE id=${u.id} AND active=true AND session_version=${u.version}`,
  );
  if (!row) throw new HttpError(401, "Session expired.");
  if (row.role === "STUDENT" && !isStudentEmailAllowed(row.email))
    throw new HttpError(401, "Student access is limited to approved accounts.");
  if (roles && !roles.includes(row.role))
    throw new HttpError(403, "You do not have permission for this action.");
  return row as Actor;
}
export function sameOrigin(req: Request) {
  if (req.method === "GET") return;
  const expected = new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? req.url,
  ).origin;
  if (req.headers.get("origin") !== expected)
    throw new HttpError(403, "Invalid request origin.");
}
