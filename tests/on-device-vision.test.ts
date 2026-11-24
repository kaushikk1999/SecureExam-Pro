import { describe, expect, it } from "vitest";
import {
  createCameraJudge,
  createVoiceJudge,
  type CameraFindings,
} from "../src/lib/on-device-vision";

const frame = (overrides: Partial<CameraFindings> = {}): CameraFindings => ({
  phone: false,
  possiblePhone: false,
  extraScreen: false,
  people: 1,
  labels: [],
  ...overrides,
});

describe("on-device camera judge", () => {
  it("warns about a phone seen in 2 of the last 3 frames, then cools down", () => {
    let time = 0;
    const judge = createCameraJudge({ now: () => time });
    expect(judge(frame({ phone: true })).warnings).toEqual([]);
    time += 1500;
    // A hand hides the phone for one frame.
    expect(judge(frame()).warnings).toEqual([]);
    time += 1500;
    expect(judge(frame({ phone: true })).warnings).toEqual([
      { type: "AI_PHONE_VISIBLE", reason: "a phone is visible in the camera" },
    ]);
    time += 1500;
    // Still visible, but within the 30 s cooldown: no repeated strike.
    expect(judge(frame({ phone: true })).warnings).toEqual([]);
    time += 30_000;
    expect(judge(frame({ phone: true })).warnings).toHaveLength(1);
  });

  it("asks the cloud check to confirm a borderline phone", () => {
    const judge = createCameraJudge({ now: () => 0 });
    expect(judge(frame({ possiblePhone: true })).confirmPhone).toBe(false);
    expect(judge(frame({ possiblePhone: true })).confirmPhone).toBe(true);
  });

  it("warns about extra people and an empty seat", () => {
    let time = 0;
    const judge = createCameraJudge({ now: () => time });
    judge(frame({ people: 2 }));
    expect(judge(frame({ people: 2 })).warnings[0]?.type).toBe(
      "AI_MULTIPLE_FACES_VISIBLE",
    );
    time += 1000;
    judge(frame({ people: 0 }));
    judge(frame({ people: 0 }));
    expect(judge(frame({ people: 0 })).warnings[0]?.type).toBe(
      "AI_FACE_NOT_VISIBLE",
    );
  });
});

describe("on-device voice judge", () => {
  // 256 frequency bins at 48 kHz: about 94 Hz per bin.
  const spectrum = (speech: boolean) =>
    Uint8Array.from({ length: 256 }, (_, bin) =>
      speech && bin >= 4 && bin <= 36 ? 200 : 20,
    );

  it("warns after about 3 s of speech-like sound, then cools down", () => {
    let time = 0;
    const judge = createVoiceJudge({ now: () => time });
    // Quiet room first, so the background level is learned.
    for (let i = 0; i < 4; i++)
      expect(judge(spectrum(false), 48000)).toBe(false);
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      time += 500;
      results.push(judge(spectrum(true), 48000));
    }
    expect(results).toEqual([false, false, false, false, false, true]);
    // Continued talking inside the cooldown does not add more strikes.
    for (let i = 0; i < 8; i++) {
      time += 500;
      expect(judge(spectrum(true), 48000)).toBe(false);
    }
  });

  it("detects a student who is already talking when checks begin", () => {
    let time = 0;
    const judge = createVoiceJudge({ now: () => time });
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      time += 500;
      results.push(judge(spectrum(true), 48000));
    }
    expect(results.at(-1)).toBe(true);
  });

  it("ignores a steady fan-like hum outside the speech band", () => {
    const judge = createVoiceJudge({ now: () => 0 });
    const hum = Uint8Array.from({ length: 256 }, (_, bin) =>
      bin <= 2 ? 255 : 30,
    );
    for (let i = 0; i < 12; i++) expect(judge(hum, 48000)).toBe(false);
  });

  it("ignores a short beep", () => {
    const judge = createVoiceJudge({ now: () => 0 });
    for (let i = 0; i < 4; i++) judge(spectrum(false), 48000);
    expect(judge(spectrum(true), 48000)).toBe(false);
    for (let i = 0; i < 8; i++)
      expect(judge(spectrum(false), 48000)).toBe(false);
  });
});
