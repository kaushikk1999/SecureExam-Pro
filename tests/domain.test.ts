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
  it("requires distance beyond uncertainty for a clear outside reading", () =>
    expect(
      geofence({ latitude: 14.00095, longitude: 100, accuracy: 20 }, room)
        .clearlyOutside,
    ).toBe(false));
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
  it("room codes rotate by time window", () => {
    expect(classroomCode("secret", 1000)).toBe(classroomCode("secret", 2000));
    expect(classroomCode("secret", 1000)).not.toBe(
      classroomCode("secret", 100000),
    );
  });
});
