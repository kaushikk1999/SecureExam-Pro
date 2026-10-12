export type LoginAudience = "student" | "teacher";
export const STUDENT_LOGIN_EMAIL = "kaushikka99@gmail.com";

/**
 * Permit Bangkok University students using verified Workspace email addresses.
 * An explicit `configured` value is a strict allowlist for tests. In production,
 * optional exact addresses extend access for approved test accounts.
 */
export function isStudentEmailAllowed(email: unknown, configured?: string) {
  const normalizedEmail = String(email ?? "")
    .trim()
    .toLowerCase();
  const configuredPolicy =
    configured ?? process.env.STUDENT_LOGIN_EMAILS?.trim() ?? "";
  const allowed = new Set(
    configuredPolicy
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowed.has("*") || allowed.has(normalizedEmail)) return true;

  // Tests can pass an explicit list to verify strict account restrictions.
  if (configured !== undefined) return false;

  // Non-production deployments may opt into a strict list. Production always
  // retains verified BU student access, even if an old test-address variable
  // remains configured in Vercel.
  if (configuredPolicy && !process.env.VERCEL) return false;
  return (
    normalizedEmail === STUDENT_LOGIN_EMAIL ||
    normalizedEmail.endsWith("@bumail.net")
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
