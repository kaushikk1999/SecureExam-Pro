import { describe, expect, it } from "vitest";
import { matchesLoginAudience } from "../src/lib/auth-role";

describe("role-specific sign-in", () => {
  it("allows students only into student sign-in", () => {
    expect(matchesLoginAudience("STUDENT", "student")).toBe(true);
    expect(matchesLoginAudience("STUDENT", "teacher")).toBe(false);
  });

  it("allows teachers and administrators into teacher sign-in", () => {
    expect(matchesLoginAudience("TEACHER", "teacher")).toBe(true);
    expect(matchesLoginAudience("ADMIN", "teacher")).toBe(true);
    expect(matchesLoginAudience("TEACHER", "student")).toBe(false);
    expect(matchesLoginAudience("ADMIN", "student")).toBe(false);
  });

  it("rejects missing or unknown session roles", () => {
    expect(matchesLoginAudience(undefined, "student")).toBe(false);
    expect(matchesLoginAudience("", "teacher")).toBe(false);
    expect(matchesLoginAudience("GUEST", "teacher")).toBe(false);
  });
});
