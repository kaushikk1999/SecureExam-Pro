import { describe, expect, it } from "vitest";
import {
  isGoogleOnlyStudentEmail,
  isStudentEmailAllowed,
  matchesLoginAudience,
  safeStudentReturnPath,
} from "../src/lib/auth-role";

it("routes the approved Gmail student account through Google sign-in", () => {
  expect(isGoogleOnlyStudentEmail("kaushikka99@gmail.com")).toBe(true);
  expect(isGoogleOnlyStudentEmail(" KAUSHIKKA99@GMAIL.COM ")).toBe(true);
  expect(isGoogleOnlyStudentEmail("another.student@gmail.com")).toBe(false);
});

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

it("allows only local exam and course enrollment links as return paths", () => {
  const examId = "d6a1c12e-1188-46ea-9a19-4e522ed2da9e";
  expect(safeStudentReturnPath(`/exam/${examId}`)).toBe(`/exam/${examId}`);
  const invite = "a".repeat(64);
  expect(safeStudentReturnPath(`/exam/${examId}?invite=${invite}`)).toBe(
    `/exam/${examId}?invite=${invite}`,
  );
  expect(
    safeStudentReturnPath(
      `/exam/${examId}?invite=${invite}&issuedAt=1791811200000`,
    ),
  ).toBe(`/exam/${examId}?invite=${invite}&issuedAt=1791811200000`);
  expect(
    safeStudentReturnPath(
      `/exam/${examId}?invite=${invite}&issuedAt=not-a-time`,
    ),
  ).toBeNull();
  expect(safeStudentReturnPath(`/exam/${examId}?invite=bad`)).toBeNull();
  const courseId = "c9a15d3a-79c8-45bb-9e62-0987654321ab";
  expect(
    safeStudentReturnPath(`/enroll/course/${courseId}?invite=${invite}`),
  ).toBe(`/enroll/course/${courseId}?invite=${invite}`);
  expect(
    safeStudentReturnPath(`/enroll/course/${courseId}?invite=bad`),
  ).toBeNull();
  expect(
    safeStudentReturnPath(`/exam/${examId}?invite=${invite}&next=/workspace`),
  ).toBeNull();
  expect(safeStudentReturnPath("/workspace")).toBeNull();
  expect(safeStudentReturnPath("https://example.com/phishing")).toBeNull();
  expect(safeStudentReturnPath(`//example.com/exam/${examId}`)).toBeNull();
});

it("enforces the configured exact student email allowlist", () => {
  expect(
    isStudentEmailAllowed("kaushikka99@gmail.com", "kaushikka99@gmail.com"),
  ).toBe(true);
  expect(
    isStudentEmailAllowed(" KAUSHIKKA99@gmail.com ", "kaushikka99@gmail.com"),
  ).toBe(true);
  expect(
    isStudentEmailAllowed("kaushikds1999@gmail.com", "kaushikka99@gmail.com"),
  ).toBe(false);
  expect(isStudentEmailAllowed("other@bumail.net", "")).toBe(false);
});

it("keeps Vercel student access pinned to the requested account", async () => {
  const { vi } = await import("vitest");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("STUDENT_LOGIN_EMAILS", "kaushikds1999@gmail.com");
  expect(isStudentEmailAllowed("kaushikka99@gmail.com")).toBe(true);
  expect(isStudentEmailAllowed("siraphob.nimn@bumail.net")).toBe(true);
  expect(isStudentEmailAllowed("kaushikds1999@gmail.com")).toBe(true);
  expect(isStudentEmailAllowed("student@other.edu")).toBe(false);
  vi.unstubAllEnvs();
});

it("allows BU student addresses in the default policy while keeping local test lists strict", async () => {
  const { vi } = await import("vitest");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("STUDENT_LOGIN_EMAILS", "");
  expect(isStudentEmailAllowed("siraphob.nimn@bumail.net")).toBe(true);
  expect(isStudentEmailAllowed("kaushikka99@gmail.com")).toBe(true);
  expect(isStudentEmailAllowed("student@other.edu")).toBe(false);

  vi.stubEnv("STUDENT_LOGIN_EMAILS", "test.student@example.com");
  expect(isStudentEmailAllowed("test.student@example.com")).toBe(true);
  expect(isStudentEmailAllowed("siraphob.nimn@bumail.net")).toBe(false);
  vi.unstubAllEnvs();
});
