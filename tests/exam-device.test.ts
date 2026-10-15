import { describe, expect, it } from "vitest";
import {
  classifyExamDevice,
  examFullscreenRequired,
  examFullscreenSatisfied,
  examScreenSharingRequired,
  isTabletSplitScreen,
  screenSharePreflightSatisfied,
  examRequestDeviceAllowed,
} from "../src/lib/exam-device";
import { policySchema, warningDecision } from "../src/lib/domain";

describe("supported exam devices", () => {
  it("keeps tablet answer entry usable when native fullscreen is dismissed", () => {
    expect(examFullscreenRequired(true, "tablet")).toBe(false);
    expect(examFullscreenSatisfied(true, "tablet", false)).toBe(true);
    expect(examFullscreenRequired(true, "laptop")).toBe(true);
    expect(examFullscreenSatisfied(true, "laptop", false)).toBe(false);
  });

  it("requires a verified entire-screen share when the check is required", () => {
    expect(screenSharePreflightSatisfied(true, false, "monitor")).toBe(false);
    expect(screenSharePreflightSatisfied(true, true, "browser")).toBe(false);
    expect(screenSharePreflightSatisfied(true, true, "window")).toBe(false);
    expect(screenSharePreflightSatisfied(true, true, "monitor")).toBe(true);
    expect(screenSharePreflightSatisfied(true, true, undefined)).toBe(false);
    expect(screenSharePreflightSatisfied(false, false, undefined)).toBe(true);
  });

  it("requires screen sharing only for laptops, not tablets", () => {
    expect(examScreenSharingRequired(true, "laptop")).toBe(true);
    expect(examScreenSharingRequired(true, "tablet")).toBe(false);
    expect(examScreenSharingRequired(true, "phone")).toBe(false);
    expect(examScreenSharingRequired(false, "laptop")).toBe(false);
  });

  it("detects tablet split-screen widths without reacting to normal browser chrome", () => {
    expect(isTabletSplitScreen(620, 1366)).toBe(true);
    expect(isTabletSplitScreen(900, 1024)).toBe(false);
    expect(isTabletSplitScreen(0, 1024)).toBe(false);
    expect(isTabletSplitScreen(600, 0)).toBe(false);
  });

  it("records split-screen detection without adding a warning strike", () => {
    const decision = warningDecision(
      2,
      "TABLET_SPLIT_VIEW",
      policySchema.parse({}),
    );
    expect(decision.warnings).toBe(2);
    expect(decision.terminate).toBe(false);
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
        mobileHint: true,
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
        userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/130",
        maxTouchPoints: 10,
        minScreenDimension: 800,
        mobileHint: true,
      }),
    ).toBe("tablet");
    expect(
      classifyExamDevice({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130",
        platform: "Linux x86_64",
        maxTouchPoints: 1,
        minScreenDimension: 800,
        mobileHint: false,
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
        userAgent:
          "Mozilla/5.0 (Linux; Android 14; Pixel 9) Chrome/130 Mobile Safari/537.36",
        maxTouchPoints: 10,
        minScreenDimension: 800,
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
        "tablet",
      ),
    ).toBe(true);
    expect(
      examRequestDeviceAllowed(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/130 Safari/537.36",
        "?1",
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
