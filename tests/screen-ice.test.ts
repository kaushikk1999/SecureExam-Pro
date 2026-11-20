import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { screenIceConfiguration } from "../src/lib/screen-ice";

describe("live screen ICE configuration", () => {
  it("keeps direct STUN as the fallback when TURN is not configured", () => {
    expect(screenIceConfiguration(undefined, undefined, "attempt:user")).toEqual({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      turnAvailable: false,
    });
  });

  it("returns short-lived Coturn REST credentials without exposing the shared secret", () => {
    const now = Date.UTC(2026, 10, 19, 0, 0, 0);
    const result = screenIceConfiguration(
      "turn:relay.example.edu:3478?transport=udp, turns:relay.example.edu:5349?transport=tcp",
      "server-only-secret",
      "attempt:user",
      now,
    );
    const username = `${Math.floor(now / 1000) + 3600}:attempt:user`;
    const expectedCredential = createHmac("sha1", "server-only-secret")
      .update(username)
      .digest("base64");

    expect(result).toEqual({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: [
            "turn:relay.example.edu:3478?transport=udp",
            "turns:relay.example.edu:5349?transport=tcp",
          ],
          username,
          credential: expectedCredential,
        },
      ],
      turnAvailable: true,
    });
    expect(JSON.stringify(result)).not.toContain("server-only-secret");
  });

  it("ignores invalid relay URL schemes and requires the shared secret", () => {
    expect(
      screenIceConfiguration("https://relay.example.edu", "secret", "id")
        .turnAvailable,
    ).toBe(false);
    expect(
      screenIceConfiguration("turn:relay.example.edu", "", "id")
        .turnAvailable,
    ).toBe(false);
  });
});
