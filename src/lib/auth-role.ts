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
