export type ExamDeviceClass = "laptop" | "tablet" | "phone" | "unsupported";

export type ExamDeviceSignals = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  minScreenDimension?: number;
  mobileHint?: boolean;
};

/** Tablets need the browser's native keyboard, which can dismiss Fullscreen API mode. */
export function examFullscreenRequired(
  policyRequiresFullscreen: boolean,
  deviceClass: ExamDeviceClass,
) {
  return policyRequiresFullscreen && deviceClass !== "tablet";
}

export function examFullscreenSatisfied(
  policyRequiresFullscreen: boolean,
  deviceClass: ExamDeviceClass,
  isFullscreen: boolean,
) {
  return (
    !examFullscreenRequired(policyRequiresFullscreen, deviceClass) ||
    isFullscreen
  );
}

/** Tablets remain eligible when their browser does not expose screen capture. */
export function screenSharePreflightSatisfied(
  required: boolean,
  isSharing: boolean,
  unavailableOnTablet: boolean,
) {
  return !required || isSharing || unavailableOnTablet;
}

const phoneUserAgent =
  /iPhone|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini|Android.*Mobile/i;
const tabletUserAgent = /iPad|Tablet|PlayBook|Silk/i;
const laptopUserAgent = /Windows NT|Macintosh|X11|Linux x86_64|CrOS/i;

export function classifyExamDevice({
  userAgent,
  platform = "",
  maxTouchPoints = 0,
  minScreenDimension = 0,
  mobileHint = false,
}: ExamDeviceSignals): ExamDeviceClass {
  if (tabletUserAgent.test(userAgent)) return "tablet";
  if (/iPhone|iPod|Windows Phone|BlackBerry|IEMobile|Opera Mini/i.test(userAgent))
    return "phone";
  if (/Android.*Mobile/i.test(userAgent)) return "phone";
  const largeTouchDevice = maxTouchPoints > 0 && minScreenDimension >= 600;
  // Desktop-site mode can hide the tablet model and report a desktop OS/UA.
  // A large touch display is the useful fallback when the UA is generic.
  if (largeTouchDevice) return "tablet";
  if (platform === "MacIntel" && maxTouchPoints > 1)
    return minScreenDimension >= 600 ? "tablet" : "phone";
  // iPadOS desktop mode and some Android tablet browsers report a generic
  // desktop/mobile hint. Prefer the tablet hardware/UA signals over that hint.
  if (/Android/i.test(userAgent)) {
    if (
      minScreenDimension >= 600 &&
      maxTouchPoints > 1
    )
      return "tablet";
    return /Mobile/i.test(userAgent) || mobileHint ? "phone" : "tablet";
  }
  if (phoneUserAgent.test(userAgent) || mobileHint) return "phone";
  if (laptopUserAgent.test(userAgent)) return "laptop";
  return "unsupported";
}

/** Server-side defense: reject phone user agents even if the client claims otherwise. */
export function examRequestDeviceAllowed(
  userAgent: string,
  mobileHeader: string | null,
  claimedClass: ExamDeviceClass,
) {
  if (phoneUserAgent.test(userAgent)) return false;
  if (
    mobileHeader === "?1" &&
    !tabletUserAgent.test(userAgent) &&
    !(claimedClass === "tablet" && /Macintosh/i.test(userAgent))
  )
    return false;
  if (claimedClass !== "laptop" && claimedClass !== "tablet") return false;

  if (tabletUserAgent.test(userAgent)) return claimedClass === "tablet";
  if (/Android/i.test(userAgent))
    return !/Mobile/i.test(userAgent) && claimedClass === "tablet";
  if (/Macintosh/i.test(userAgent)) return true;
  // The client can identify touch tablets whose browser is using desktop-site
  // mode. Their server-visible UA is indistinguishable from a laptop UA.
  if (claimedClass === "tablet" && laptopUserAgent.test(userAgent)) return true;
  return laptopUserAgent.test(userAgent) && claimedClass === "laptop";
}
