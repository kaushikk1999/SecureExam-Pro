export type LoginAudience = "student" | "teacher";

export function matchesLoginAudience(role: unknown, audience: LoginAudience) {
  return audience === "student"
    ? role === "STUDENT"
    : role === "TEACHER" || role === "ADMIN";
}
