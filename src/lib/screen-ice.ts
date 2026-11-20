import { createHmac } from "node:crypto";

const defaultIceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

/**
 * Build short-lived Coturn REST credentials for a live screen-view session.
 * The shared secret remains on the server; only the one-hour TURN credential
 * is returned to the authenticated student and instructor browsers.
 */
export function screenIceConfiguration(
  turnUrls: string | undefined,
  sharedSecret: string | undefined,
  identity: string,
  now = Date.now(),
) {
  const urls = (turnUrls ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => /^turns?:/i.test(url));

  if (!urls.length || !sharedSecret?.trim()) {
    return { iceServers: defaultIceServers, turnAvailable: false };
  }

  const expiresAt = Math.floor(now / 1000) + 60 * 60;
  const username = `${expiresAt}:${identity}`;
  const credential = createHmac("sha1", sharedSecret)
    .update(username)
    .digest("base64");

  return {
    iceServers: [
      ...defaultIceServers,
      { urls, username, credential },
    ] satisfies RTCIceServer[],
    turnAvailable: true,
  };
}
