import { sql } from "drizzle-orm";
import { db, query } from "./db";
// The OIDC library validates signature, issuer, audience, state and nonce before this callback.
// Application authorization still requires an explicit issuer + subject mapping.
export async function resolveUniversityIdentity(
  profile: Record<string, unknown> | undefined,
) {
  const issuer = process.env.SSO_ISSUER;
  if (
    !issuer ||
    !profile ||
    profile.iss !== issuer ||
    typeof profile.sub !== "string" ||
    !profile.sub
  )
    return null;
  const [u] = await query(
    sql`SELECT u.* FROM sso_identities s JOIN users u ON u.id=s.user_id WHERE s.issuer=${issuer} AND s.subject=${profile.sub} AND u.active=true`,
  );
  if (!u) return null;
  if (
    u.mfa_secret ||
    (u.role !== "STUDENT" && process.env.REQUIRE_TEACHER_MFA === "true")
  ) {
    const amr = process.env.SSO_REQUIRED_AMR || "mfa";
    if (!Array.isArray(profile.amr) || !profile.amr.includes(amr)) return null;
  }
  return u;
}

// Google is authoritative for gmail.com and verified Workspace hosted domains.
// Non-Google-managed addresses need the explicit issuer/subject mapping instead.
export async function resolveGoogleIdentity(
  profile: Record<string, unknown> | undefined,
) {
  if (
    !profile ||
    profile.email_verified !== true ||
    typeof profile.sub !== "string" ||
    typeof profile.email !== "string" ||
    !["https://accounts.google.com", "accounts.google.com"].includes(
      String(profile.iss),
    )
  )
    return null;
  const email = profile.email.toLowerCase();
  return db.transaction(async (tx) => {
    const issuer = "https://accounts.google.com";
    const [mapped] = await query(
      sql`SELECT u.* FROM sso_identities s JOIN users u ON u.id=s.user_id WHERE s.issuer=${issuer} AND s.subject=${profile.sub} AND u.active=true`,
      tx,
    );
    let u = mapped;
    if (!u) {
      if (
        !email.endsWith("@gmail.com") &&
        !(typeof profile.hd === "string" && profile.hd === email.split("@")[1])
      )
        return null;
      const [existing] = await query(
        sql`SELECT * FROM users WHERE lower(email)=${email} AND active=true FOR UPDATE`,
        tx,
      );
      if (!existing) return null;
      u = existing;
      const [other] = await query(
        sql`SELECT subject FROM sso_identities WHERE issuer=${issuer} AND user_id=${u.id}`,
        tx,
      );
      if (other && other.subject !== profile.sub) return null;
      if (
        u.mfa_secret ||
        (u.role !== "STUDENT" && process.env.REQUIRE_TEACHER_MFA === "true")
      )
        return null;
      await tx.execute(
        sql`INSERT INTO sso_identities(issuer,subject,user_id) VALUES(${issuer},${profile.sub},${u.id}) ON CONFLICT DO NOTHING`,
      );
    }
    if (
      u.mfa_secret ||
      (u.role !== "STUDENT" && process.env.REQUIRE_TEACHER_MFA === "true")
    )
      return null;
    return u;
  });
}
