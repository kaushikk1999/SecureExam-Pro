import { describe, expect, it } from "vitest";
import {
  classifyExamDevice,
  examFullscreenRequired,
  examFullscreenSatisfied,
  examRequestDeviceAllowed,
} from "../src/lib/exam-device";

describe("supported exam devices", () => {
  it("keeps tablet answer entry usable when native fullscreen is dismissed", () => {
    expect(examFullscreenRequired(true, "tablet")).toBe(false);
    expect(examFullscreenSatisfied(true, "tablet", false)).toBe(true);
    expect(examFullscreenRequired(true, "laptop")).toBe(true);
    expect(examFullscreenSatisfied(true, "laptop", false)).toBe(false);
  });

  it("allows laptops and common iPad and Android tablet identifiers", () => {
    expect(
      classifyExamDevice({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130",
      }),
    ).toBe("laptop");
    expect(
      classifyExamDevice({
        userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
      }),
    ).toBe("tablet");
    expect(
      classifyExamDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
        platform: "MacIntel",
        maxTouchPoints: 5,
        minScreenDimension: 768,
      }),
    ).toBe("tablet");
    expect(
      classifyExamDevice({
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/130 Safari/537.36",
      }),
    ).toBe("tablet");
  });

  it("rejects phones, including iPadOS-style desktop mode on a phone", () => {
    expect(
      classifyExamDevice({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      }),
    ).toBe("phone");
    expect(
      classifyExamDevice({
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 9) Chrome/130 Mobile Safari/537.36",
        mobileHint: true,
      }),
    ).toBe("phone");
    expect(
      classifyExamDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
        platform: "MacIntel",
        maxTouchPoints: 5,
        minScreenDimension: 393,
      }),
    ).toBe("phone");
  });

  it("enforces the server-side phone block even if the client claims tablet", () => {
    expect(
      examRequestDeviceAllowed(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        null,
        "tablet",
      ),
    ).toBe(false);
    expect(
      examRequestDeviceAllowed(
        "Mozilla/5.0 (Linux; Android 14; Pixel 9) Chrome/130",
        "?1",
        "tablet",
      ),
    ).toBe(false);
    expect(
      examRequestDeviceAllowed(
        "Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/130 Safari/537.36",
        "?0",
        "tablet",
      ),
    ).toBe(true);
    expect(
      examRequestDeviceAllowed(
        "Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36",
        "?0",
        "laptop",
      ),
    ).toBe(true);
  });
});
