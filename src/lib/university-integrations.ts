import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, query } from "./db";
import { HttpError, type Actor } from "./auth";
import { audit } from "./audit";

export function ssoConfigured() {
  return Boolean(
    process.env.SSO_ISSUER?.startsWith("https://") &&
      process.env.SSO_CLIENT_ID &&
      process.env.SSO_CLIENT_SECRET,
  );
}

export async function integrationRequest(
  req: Request,
  parts: string[],
  u: Actor,
  body: () => Promise<any>,
) {
  if (u.role !== "ADMIN")
    throw new HttpError(
      403,
      "Only administrators manage university integrations.",
    );
  const [action] = parts;
  if (req.method === "GET") {
    if (action) throw new HttpError(404, "Integration route not found.");
    return {
      google: {
        configured: Boolean(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
        ),
        callback: "/api/auth/callback/google",
      },
      sso: {
        configured: ssoConfigured(),
        issuer: process.env.SSO_ISSUER ?? "",
        callback: "/api/auth/callback/university",
      },
      identities: await query(
        sql`SELECT s.issuer,s.subject,s.user_id,u.email FROM sso_identities s JOIN users u ON u.id=s.user_id ORDER BY u.email`,
      ),
    };
  }
  if (req.method !== "POST") throw new HttpError(405, "POST required.");
  if (action !== "identity")
    throw new HttpError(404, "Integration action not found.");

  const v = z
    .object({
      email: z.email().max(254),
      subject: z.string().trim().min(1).max(255),
      remove: z.boolean().default(false),
    })
    .parse(await body());
  if (!ssoConfigured())
    throw new HttpError(
      503,
      "Configure the university OpenID Connect provider first.",
    );
  const issuer = process.env.SSO_ISSUER!;
  await db.transaction(async (tx) => {
    const [account] = await query(
      sql`SELECT id FROM users WHERE email=${v.email.toLowerCase()} AND active=true`,
      tx,
    );
    if (!account)
      throw new HttpError(
        404,
        "Active local account not found. Create it before mapping SSO.",
      );
    if (v.remove)
      await tx.execute(
        sql`DELETE FROM sso_identities WHERE issuer=${issuer} AND subject=${v.subject} AND user_id=${account.id}`,
      );
    else
      await tx.execute(
        sql`INSERT INTO sso_identities(issuer,subject,user_id) VALUES(${issuer},${v.subject},${account.id})`,
      );
    await tx.execute(
      sql`UPDATE users SET session_version=session_version+1 WHERE id=${account.id}`,
    );
    await audit(tx, {
      userId: u.id,
      type: v.remove ? "SSO_IDENTITY_REMOVED" : "SSO_IDENTITY_LINKED",
      metadata: { userId: account.id },
    });
  });
  return { ok: true };
}
