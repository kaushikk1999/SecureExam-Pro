import { describe, it, expect } from "vitest";
import {
  geofence,
  grade,
  policySchema,
  warningDecision,
  shuffled,
  deadline,
  remaining,
  csv,
  auditHash,
  classroomCode,
  CLASSROOM_CODE_WINDOW_MS,
  validClassroomCode,
  createExamEnrollmentInvite,
  validExamEnrollmentInvite,
  createCourseEnrollmentInvite,
  validCourseEnrollmentInvite,
} from "../src/lib/domain";
const room = { latitude: 14, longitude: 100, radius: 100, accuracy: 30 };
describe("location uncertainty", () => {
  it("accepts an accurate classroom point", () =>
    expect(geofence({ ...room, accuracy: 10 }, room)).toMatchObject({
      inside: true,
      acceptable: true,
    }));
  it("does not classify poor accuracy as credible", () =>
    expect(
      geofence({ latitude: 14.1, longitude: 100, accuracy: 1000 }, room)
        .acceptable,
    ).toBe(false));
  it("accepts typical indoor GPS uncertainty up to the room radius", () => {
    expect(
      geofence({ latitude: 14, longitude: 100, accuracy: 79 }, room),
    ).toMatchObject({ inside: true, acceptable: true });
    expect(
      geofence({ latitude: 14, longitude: 100, accuracy: 101 }, room)
        .acceptable,
    ).toBe(false);
  });
  it("requires distance beyond uncertainty for a clear outside reading", () =>
    expect(
      geofence({ latitude: 14.00095, longitude: 100, accuracy: 20 }, room)
        .clearlyOutside,
    ).toBe(false));
});
describe("course enrollment invitations", () => {
  const secret = "course-signing-secret-that-is-long-enough-to-be-safe";
  const courseId = "c9a15d3a-79c8-45bb-9e62-0987654321ab";
  it("creates a unique invite for each course and rejects tampering", () => {
    const token = createCourseEnrollmentInvite(secret, courseId);
    expect(validCourseEnrollmentInvite(secret, courseId, token)).toBe(true);
    expect(
      validCourseEnrollmentInvite(
        secret,
        "d6a1c12e-1188-46ea-9a19-4e522ed2da9e",
        token,
      ),
    ).toBe(false);
    expect(validCourseEnrollmentInvite(secret, courseId, "bad-token")).toBe(
      false,
    );
  });
});
describe("exam course enrollment invitations", () => {
  const secret = "a".repeat(64);
  const examId = "d6a1c12e-1188-46ea-9a19-4e522ed2da9e";
  const courseId = "c9a15d3a-79c8-45bb-9e62-0987654321ab";

  it("binds invitations to the exam and its course", () => {
    const token = createExamEnrollmentInvite(secret, examId, courseId);
    expect(validExamEnrollmentInvite(secret, examId, courseId, token)).toBe(
      true,
    );
    expect(
      validExamEnrollmentInvite(secret, examId, "another-course", token),
    ).toBe(false);
    expect(
      validExamEnrollmentInvite(secret, "another-exam", courseId, token),
    ).toBe(false);
  });

  it("supports classroom-code timestamps and rejects malformed tokens", () => {
    const token = createExamEnrollmentInvite(
      `${secret}:1791811200000`,
      examId,
      courseId,
    );
    expect(
      validExamEnrollmentInvite(
        `${secret}:1791811200000`,
        examId,
        courseId,
        token,
      ),
    ).toBe(true);
    expect(
      validExamEnrollmentInvite(secret, examId, courseId, "not-a-token"),
    ).toBe(false);
    expect(() =>
      createExamEnrollmentInvite("invalid", examId, courseId),
    ).toThrow("Exam invitation key is invalid.");
  });
});
describe("objective policy", () => {
  it("auto submits at the fifth warning", () =>
    expect(warningDecision(4, "TAB_HIDDEN", policySchema.parse({}))).toEqual({
      warnings: 5,
      terminate: true,
    }));
  it("does not warn for low accuracy or network loss", () => {
    for (const type of [
      "LOCATION_ACCURACY_LOW",
      "NETWORK_DISCONNECTED",
      "LOCATION_UNAVAILABLE",
    ])
      expect(warningDecision(2, type, policySchema.parse({}))).toEqual({
        warnings: 2,
        terminate: false,
      });
  });
  it("honors disabled tab monitoring", () =>
    expect(
      warningDecision(
        0,
        "TAB_HIDDEN",
        policySchema.parse({ tabMonitoring: false }),
      ).warnings,
    ).toBe(0));
});
describe("determinism and grades", () => {
  it("persists reproducible ordering without mutating input", () => {
    const v = [1, 2, 3, 4, 5];
    expect(shuffled(v, "a")).toEqual(shuffled(v, "a"));
    expect(v).toEqual([1, 2, 3, 4, 5]);
  });
  it("grades unordered multi-select and numeric responses", () => {
    expect(grade("MULTI_SELECT", ["b", "a"], ["a", "b"], 4)).toBe(4);
    expect(grade("NUMERIC", "4", 4, 5)).toBe(5);
    expect(grade("ESSAY", "response", null, 10)).toBeNull();
  });
  it("treats empty choices as unanswered", () =>
    expect(grade("MULTI_SELECT", [], ["a"], 5, 1)).toBe(0));
  it("caps deadline at closing time", () =>
    expect(deadline(0, 90, new Date(60000)).getTime()).toBe(60000));
  it("remaining time uses the provided server time", () =>
    expect(remaining(new Date(120000), 60000)).toBe(60000));
  it("neutralizes spreadsheet formula injection", () =>
    expect(csv([["=SUM(A1)", "  +cmd", "hello,world"]])).toContain(
      '"\'=SUM(A1)"',
    ));
  it("hash chain detects a changed event", () =>
    expect(auditHash("GENESIS", { event: 1 })).not.toBe(
      auditHash("GENESIS", { event: 2 }),
    ));
  it("room codes remain valid for five minutes after issue", () => {
    const issuedAt = 123456;
    const secret = "a".repeat(64);
    const code = classroomCode(secret, issuedAt);
    const storedSecret = `${secret}:${issuedAt}`;
    expect(classroomCode(secret, issuedAt)).toBe(code);
    expect(validClassroomCode(storedSecret, code, issuedAt)).toBe(true);
    expect(
      validClassroomCode(
        storedSecret,
        code,
        issuedAt + CLASSROOM_CODE_WINDOW_MS - 1,
      ),
    ).toBe(true);
    expect(
      validClassroomCode(
        storedSecret,
        code,
        issuedAt + CLASSROOM_CODE_WINDOW_MS,
      ),
    ).toBe(false);
    expect(validClassroomCode(storedSecret, code, issuedAt - 1)).toBe(false);
    expect(validClassroomCode(storedSecret, "000000", issuedAt)).toBe(false);
  });
});
