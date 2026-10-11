export type LoginAudience = "student" | "teacher";

/**
 * When configured, restrict every student account to this exact email list.
 * An unset/empty value preserves the deployment's normal student policy.
 */
export function isStudentEmailAllowed(
  email: unknown,
  configured = process.env.STUDENT_LOGIN_EMAILS,
) {
  const allowed = new Set(
    (configured ?? "")
      .split(/[\s,]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  return (
    allowed.size === 0 ||
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
  const match = next.match(
    /^\/exam\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\?invite=([a-f0-9]{64}))?$/i,
  );
  if (!match) return null;
  return `/exam/${match[1]}${match[2] ? `?invite=${match[2].toLowerCase()}` : ""}`;
}
