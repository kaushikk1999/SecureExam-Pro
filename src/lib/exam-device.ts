export type ExamDeviceClass = "laptop" | "tablet" | "phone" | "unsupported";

export type ExamDeviceSignals = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  minScreenDimension?: number;
  mobileHint?: boolean;
};

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
  if (mobileHint || phoneUserAgent.test(userAgent)) return "phone";
  if (tabletUserAgent.test(userAgent)) return "tablet";
  if (/Android/i.test(userAgent)) return "tablet";
  if (platform === "MacIntel" && maxTouchPoints > 1)
    return minScreenDimension >= 600 ? "tablet" : "phone";
  if (laptopUserAgent.test(userAgent)) return "laptop";
  return "unsupported";
}

/** Server-side defense: reject phone user agents even if the client claims otherwise. */
export function examRequestDeviceAllowed(
  userAgent: string,
  mobileHeader: string | null,
  claimedClass: ExamDeviceClass,
) {
  if (mobileHeader === "?1" || phoneUserAgent.test(userAgent)) return false;
  if (claimedClass !== "laptop" && claimedClass !== "tablet") return false;

  if (tabletUserAgent.test(userAgent)) return claimedClass === "tablet";
  if (/Android/i.test(userAgent))
    return !/Mobile/i.test(userAgent) && claimedClass === "tablet";
  if (/Macintosh/i.test(userAgent)) return true;
  return laptopUserAgent.test(userAgent) && claimedClass === "laptop";
}
