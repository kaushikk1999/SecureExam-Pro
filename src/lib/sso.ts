import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, query } from "./db";
import { isStudentEmailAllowed, STUDENT_LOGIN_EMAIL } from "./auth-role";
import { OAUTH_ONLY_PASSWORD_HASH } from "./password";
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
  if (u.role === "STUDENT" && !isStudentEmailAllowed(u.email)) return null;
  if (
    u.mfa_secret ||
    (u.role !== "STUDENT" && process.env.REQUIRE_TEACHER_MFA === "true")
  ) {
    const amr = process.env.SSO_REQUIRED_AMR || "mfa";
    if (!Array.isArray(profile.amr) || !profile.amr.includes(amr)) return null;
  }
  return u;
}

function configuredValues(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

// Exact staff addresses explicitly approved for first-time teacher access.
// Keep this list address-specific; never add a whole university domain here.
const sourceApprovedTeacherEmails = ["adrian.b@bu.ac.th"];

// Google is authoritative for verified Workspace hosted domains. New accounts
// are created only for domains explicitly enabled by the deployment.
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
  const emailDomain = email.split("@").at(-1) ?? "";
  const verifiedWorkspace =
    typeof profile.hd === "string" &&
    profile.hd.toLowerCase() === emailDomain &&
    emailDomain.length > 0;
  const autoProvisionDomains = configuredValues(
    process.env.GOOGLE_AUTO_PROVISION_DOMAINS,
  );
  // BU students use Google Workspace accounts on bumail.net. Keep this enabled
  // even when the optional Vercel allowlist is unset.
  autoProvisionDomains.add("bumail.net");
  // Keep support for BU staff accounts when they authenticate through Google.
  autoProvisionDomains.add("bu.ac.th");
  // Keep one-off teacher invitations additive so provisioning another teacher
  // never overwrites the primary allowlist maintained in Vercel.
  const teacherEmails = configuredValues(
    [
      process.env.GOOGLE_TEACHER_EMAILS,
      process.env.GOOGLE_TEACHER_EMAILS_ADDITIONAL,
    ].join(","),
  );
  for (const approvedEmail of sourceApprovedTeacherEmails)
    teacherEmails.add(approvedEmail);
  const isApprovedTeacher = teacherEmails.has(email);
  const isApprovedStudent = isStudentEmailAllowed(email);
  const explicitStudentAllowlist = configuredValues(
    [STUDENT_LOGIN_EMAIL, process.env.STUDENT_LOGIN_EMAILS ?? ""].join(","),
  );
  return db.transaction(async (tx) => {
    const issuer = "https://accounts.google.com";
    const [mapped] = await query(
      sql`SELECT u.* FROM sso_identities s JOIN users u ON u.id=s.user_id WHERE s.issuer=${issuer} AND s.subject=${profile.sub} AND u.active=true`,
      tx,
    );
    let u = mapped;
    if (!u) {
      // An explicitly approved exact teacher address can be authenticated by
      // Google without a hosted-domain claim (for example, a federated staff
      // address). The verified email check above plus the exact allowlist is
      // the authorization boundary for this case.
      if (
        !email.endsWith("@gmail.com") &&
        !verifiedWorkspace &&
        !isApprovedTeacher
      )
        return null;
      const [existing] = await query(
        sql`SELECT * FROM users WHERE lower(email)=${email} FOR UPDATE`,
        tx,
      );
      if (existing && !existing.active) return null;
      u = existing;
      if (
        u?.role === "STUDENT" &&
        !isStudentEmailAllowed(u.email) &&
        !isApprovedTeacher
      )
        return null;
      const canProvisionTrustedWorkspace =
        verifiedWorkspace && autoProvisionDomains.has(emailDomain);
      const canProvisionExactStudent =
        explicitStudentAllowlist.has(email) && email.endsWith("@gmail.com");
      if (
        !u &&
        (isApprovedTeacher
          ? true
          : isApprovedStudent &&
            (canProvisionTrustedWorkspace || canProvisionExactStudent))
      ) {
        const id = randomUUID();
        const displayName =
          typeof profile.name === "string" && profile.name.trim()
            ? profile.name.trim().slice(0, 120)
            : email.split("@")[0].slice(0, 120);
        const role = isApprovedTeacher ? "TEACHER" : "STUDENT";
        const [created] = await query(
          sql`INSERT INTO users(id,email,name,password_hash,role) VALUES(${id},${email},${displayName},${OAUTH_ONLY_PASSWORD_HASH},${role}) ON CONFLICT (email) DO NOTHING RETURNING *`,
          tx,
        );
        u = created;
        // A concurrent first sign-in may have inserted the account first.
        if (!u) {
          const [raced] = await query(
            sql`SELECT * FROM users WHERE lower(email)=${email} FOR UPDATE`,
            tx,
          );
          if (!raced?.active) return null;
          u = raced;
        }
      }
      if (!u) return null;
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
      const [identity] = await query(
        sql`SELECT user_id FROM sso_identities WHERE issuer=${issuer} AND subject=${profile.sub}`,
        tx,
      );
      if (identity?.user_id !== u.id) return null;
    }
    // An explicit exact-email teacher invitation also corrects an existing
    // student-role record for that same verified Google identity.
    if (u.role === "STUDENT" && isApprovedTeacher) {
      const [promoted] = await query(
        sql`UPDATE users SET role='TEACHER' WHERE id=${u.id} AND role='STUDENT' RETURNING *`,
        tx,
      );
      if (!promoted) return null;
      u = promoted;
    }
    if (u.role === "STUDENT" && !isStudentEmailAllowed(u.email)) return null;
    if (
      u.mfa_secret ||
      (u.role !== "STUDENT" && process.env.REQUIRE_TEACHER_MFA === "true")
    )
      return null;
    return u;
  });
}
