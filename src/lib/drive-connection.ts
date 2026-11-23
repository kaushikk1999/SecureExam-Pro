/**
 * Connect a teacher's own Google Drive (for example a Bangkok University
 * Workspace account) so screen recordings are stored in that account instead
 * of a service account or Vercel Blob. Uses OAuth with the narrow drive.file
 * scope: the app can only see files and folders it created.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { sql } from "drizzle-orm";
import { query } from "./db";
import { HttpError } from "./auth";

const SCOPES = "openid email https://www.googleapis.com/auth/drive.file";
const ROOT_FOLDER_NAME = "Secure Exam recordings";
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export type DriveOwnerAccess = {
  userId: string;
  token: string;
  rootFolderId: string;
};

function encryptionKey() {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret)
    throw new HttpError(503, "The deployment auth secret is not configured.");
  return createHash("sha256")
    .update("secure-exam-drive-connection:" + secret)
    .digest();
}

export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((part) => part.toString("hex"))
    .join(".");
}

export function decryptToken(value: string) {
  const [iv, tag, data] = value.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

export function driveOAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    (process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET),
  );
}

export function driveCallbackUrl(origin: string) {
  return `${origin}/api/platform/drive-connection/callback`;
}

/** PKCE verifier/challenge and CSRF state for one connect attempt. */
export function newAuthorizationRequest() {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

export function authorizationUrl(input: {
  origin: string;
  state: string;
  challenge: string;
  loginHint?: string;
}) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: driveCallbackUrl(input.origin),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // Always show consent so Google returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  }).toString();
  return url.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      ...params,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const result = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  return { ok: response.ok, status: response.status, result };
}

function emailFromIdToken(idToken?: string) {
  // The ID token comes straight from Google's token endpoint over TLS in
  // exchange for our authorization code, so its payload can be read directly.
  try {
    const payload = JSON.parse(
      Buffer.from(idToken?.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { email?: string; email_verified?: boolean };
    return payload.email_verified ? (payload.email ?? "") : "";
  } catch {
    return "";
  }
}

/** Exchange the authorization code, create the root folder and save the connection. */
export async function completeDriveConnection(input: {
  userId: string;
  code: string;
  verifier: string;
  origin: string;
}) {
  const { ok, result } = await tokenRequest({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: driveCallbackUrl(input.origin),
  });
  if (!ok || !result.access_token) {
    console.error("Google Drive connection failed", {
      oauthError: result.error?.slice(0, 100),
      oauthDescription: result.error_description?.slice(0, 200),
    });
    throw new HttpError(502, "Google did not complete the Drive connection.");
  }
  if (!result.scope?.split(" ").includes(SCOPES.split(" ")[2]))
    throw new HttpError(
      400,
      "Google Drive access was not granted. Connect again and allow Drive access.",
    );
  if (!result.refresh_token)
    throw new HttpError(
      502,
      "Google did not return a long-lived Drive connection. Remove Secure Exam from your Google account's third-party access, then connect again.",
    );
  const email = emailFromIdToken(result.id_token);
  const folder = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${result.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: ROOT_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const created = (await folder.json().catch(() => ({}))) as { id?: string };
  if (!folder.ok || !created.id)
    throw new HttpError(
      502,
      "Connected to Google, but could not create the recordings folder in Drive.",
    );
  await query(sql`
    INSERT INTO drive_connections(user_id,google_email,refresh_token_enc,root_folder_id,connected_at)
    VALUES(${input.userId},${email},${encryptToken(result.refresh_token)},${created.id},now())
    ON CONFLICT(user_id) DO UPDATE SET
      google_email=EXCLUDED.google_email,
      refresh_token_enc=EXCLUDED.refresh_token_enc,
      root_folder_id=EXCLUDED.root_folder_id,
      connected_at=EXCLUDED.connected_at
  `);
  tokenCache.set(input.userId, {
    token: result.access_token,
    expiresAt: Date.now() + ((result.expires_in ?? 3600) - 120) * 1000,
  });
  return { email, rootFolderId: created.id };
}

export async function driveConnectionStatus(userId: string) {
  const [row] = await query<{
    google_email: string;
    connected_at: string;
  }>(
    sql`SELECT google_email,connected_at FROM drive_connections WHERE user_id=${userId}`,
  );
  return {
    available: driveOAuthConfigured(),
    connected: Boolean(row),
    email: row?.google_email ?? null,
    connectedAt: row?.connected_at ?? null,
  };
}

export async function disconnectDrive(userId: string) {
  const [row] = await query<{ refresh_token_enc: string }>(
    sql`DELETE FROM drive_connections WHERE user_id=${userId} RETURNING refresh_token_enc`,
  );
  tokenCache.delete(userId);
  if (!row) return;
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: decryptToken(row.refresh_token_enc),
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // The local connection is removed either way.
  }
}

/** A fresh access token for a teacher's connected Drive, or null if none. */
export async function userDriveAccess(
  userId: string,
): Promise<DriveOwnerAccess | null> {
  const [row] = await query<{
    refresh_token_enc: string;
    root_folder_id: string;
  }>(
    sql`SELECT refresh_token_enc,root_folder_id FROM drive_connections WHERE user_id=${userId}`,
  );
  if (!row) return null;
  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now())
    return { userId, token: cached.token, rootFolderId: row.root_folder_id };
  const { ok, result } = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: decryptToken(row.refresh_token_enc),
  });
  if (!ok || !result.access_token) {
    console.error("Google Drive token refresh failed", {
      oauthError: result.error?.slice(0, 100),
      oauthDescription: result.error_description?.slice(0, 200),
    });
    throw new HttpError(
      503,
      "The instructor's Google Drive connection has expired or was removed. Ask the instructor to reconnect Google Drive in Settings.",
    );
  }
  tokenCache.set(userId, {
    token: result.access_token,
    expiresAt: Date.now() + ((result.expires_in ?? 3600) - 120) * 1000,
  });
  return {
    userId,
    token: result.access_token,
    rootFolderId: row.root_folder_id,
  };
}

/** Drive access for the teacher who owns an exam's course, if connected. */
export async function examOwnerDriveAccess(examId: string) {
  const [owner] = await query<{ teacher_id: string }>(
    sql`SELECT c.teacher_id FROM exams e JOIN courses c ON c.id=e.course_id WHERE e.id=${examId}`,
  );
  return owner ? userDriveAccess(owner.teacher_id) : null;
}
