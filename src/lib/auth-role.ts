export type LoginAudience = "student" | "teacher";
export const STUDENT_LOGIN_EMAIL = "kaushikka99@gmail.com";

/**
 * Restrict student accounts to an exact allowlist. Production on Vercel is
 * pinned to the current test account; local environments can use an explicit
 * list (or '*' for isolated browser tests).
 */
export function isStudentEmailAllowed(email: unknown, configured?: string) {
  const studentPolicy =
    configured ??
    (process.env.VERCEL
      ? STUDENT_LOGIN_EMAIL
      : process.env.STUDENT_LOGIN_EMAILS?.trim() || STUDENT_LOGIN_EMAIL);
  const allowed = new Set(
    studentPolicy
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  return (
    allowed.has("*") ||
    allowed.has(
      String(email ?? "")
        .trim()
        .toLowerCase(),
    )
  );
}

export function matchesLoginAudience(role: unknown, audience: LoginAudience) {
  return audience === "student"
    ? role === "STUDENT"
    : role === "TEACHER" || role === "ADMIN";
}

/** Only allow app-owned exam URLs as a post-login destination. */
export function safeStudentReturnPath(next: string | null | undefined) {
  if (!next) return null;
  const courseMatch = next.match(
    /^\/enroll\/course\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\?invite=([a-f0-9]{64})$/i,
  );
  if (courseMatch)
    return `/enroll/course/${courseMatch[1]}?invite=${courseMatch[2].toLowerCase()}`;
  const match = next.match(
    /^\/exam\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\?invite=([a-f0-9]{64}))?$/i,
  );
  if (!match) return null;
  return `/exam/${match[1]}${match[2] ? `?invite=${match[2].toLowerCase()}` : ""}`;
}
