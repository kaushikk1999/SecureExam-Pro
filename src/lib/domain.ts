import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
export const policySchema = z.object({
  camera: z.boolean().default(true),
  microphone: z.boolean().default(true),
  location: z.boolean().default(true),
  screen: z.boolean().default(false),
  fullscreen: z.boolean().default(true),
  classroomCode: z.boolean().default(true),
  teacherApproval: z.boolean().default(false),
  allowCopy: z.boolean().default(false),
  allowPaste: z.boolean().default(false),
  maxWarnings: z.number().int().min(1).max(50).default(5),
  autoTerminate: z.boolean().default(true),
  randomize: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  poolSize: z.number().int().min(0).max(200).default(0),
  allowMobile: z.boolean().default(false),
  tabMonitoring: z.boolean().default(true),
  navigation: z.boolean().default(true),
  allowDownload: z.boolean().default(false),
  negativeMarks: z.number().min(0).max(100).default(0),
  retentionDays: z.number().int().min(7).max(3650).default(90),
  offlineGraceSeconds: z.number().int().min(30).max(3600).default(120),
});
export type Policy = z.infer<typeof policySchema>;
export const classroomSchema = z.object({
  name: z.string().min(1).max(120),
  building: z.string().max(120).default(""),
  floor: z.string().max(40).default(""),
  room: z.string().max(40).default(""),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius: z.number().min(10).max(5000),
  accuracy: z.number().min(1).max(1000),
});
export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(10000),
});
export function distance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.latitude - a.latitude) * r) / 2) ** 2 +
    Math.cos(a.latitude * r) *
      Math.cos(b.latitude * r) *
      Math.sin(((b.longitude - a.longitude) * r) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function geofence(
  point: z.infer<typeof locationSchema>,
  room: {
    latitude: number;
    longitude: number;
    radius: number;
    accuracy: number;
  },
) {
  const metres = distance(point, room);
  return {
    distance: metres,
    inside: metres <= room.radius,
    clearlyOutside: metres - point.accuracy > room.radius,
    acceptable: point.accuracy <= room.accuracy,
  };
}
export const hardEvents = [
  "TAB_HIDDEN",
  "WINDOW_BLUR",
  "FULLSCREEN_EXIT",
  "CAMERA_DISABLED",
  "MICROPHONE_DISABLED",
  "SCREEN_SHARE_STOPPED",
  "LOCATION_OUTSIDE_GEOFENCE",
  "PASTE_ATTEMPT",
] as const;
export function isHard(type: string, p: Policy) {
  if (type === "TAB_HIDDEN" || type === "WINDOW_BLUR") return p.tabMonitoring;
  if (type === "FULLSCREEN_EXIT") return p.fullscreen;
  if (type === "CAMERA_DISABLED") return p.camera;
  if (type === "MICROPHONE_DISABLED") return p.microphone;
  if (type === "SCREEN_SHARE_STOPPED") return p.screen;
  if (type === "LOCATION_OUTSIDE_GEOFENCE") return p.location;
  if (type === "PASTE_ATTEMPT") return !p.allowPaste;
  return false;
}
export function warningDecision(current: number, type: string, p: Policy) {
  const warnings = current + (isHard(type, p) ? 1 : 0);
  return {
    warnings,
    terminate: p.autoTerminate && warnings >= p.maxWarnings && isHard(type, p),
  };
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export function auditHash(previous: string, data: unknown) {
  return createHash("sha256")
    .update(previous + "\n" + canonical(data))
    .digest("hex");
}
export const CLASSROOM_CODE_WINDOW_MS = 5 * 60_000;

export function classroomCode(secret: string, time = Date.now()) {
  const n = createHmac("sha256", secret)
    .update(String(time))
    .digest()
    .readUInt32BE(0);
  return String(n % 1000000).padStart(6, "0");
}
function legacyClassroomCode(secret: string, time = Date.now()) {
  const n = createHmac("sha256", secret)
    .update(String(Math.floor(time / CLASSROOM_CODE_WINDOW_MS)))
    .digest()
    .readUInt32BE(0);
  return String(n % 1000000).padStart(6, "0");
}
export function validClassroomCode(
  storedSecret: string,
  code: string,
  now = Date.now(),
) {
  const match = /^([a-f0-9]{64}):(\d+)$/.exec(storedSecret);
  const secret = match?.[1] ?? storedSecret;
  if (!match) return code === legacyClassroomCode(secret, now);
  const issuedAtMs = Number(match[2]);
  return (
    Number.isFinite(issuedAtMs) &&
    issuedAtMs <= now &&
    now < issuedAtMs + CLASSROOM_CODE_WINDOW_MS &&
    code === classroomCode(secret, issuedAtMs)
  );
}
export function classroomCodeSecret(secret: string, issuedAt: number) {
  return `${secret}:${issuedAt}`;
}
export function remaining(deadline: string | Date, now = Date.now()) {
  return Math.max(0, new Date(deadline).getTime() - now);
}
export function deadline(start: number, minutes: number, end: string | Date) {
  return new Date(Math.min(start + minutes * 60000, new Date(end).getTime()));
}
export function shuffled<T>(items: T[], seed: string) {
  return [...items].sort((a, b) =>
    createHash("sha256")
      .update(seed + canonical(a))
      .digest("hex")
      .localeCompare(
        createHash("sha256")
          .update(seed + canonical(b))
          .digest("hex"),
      ),
  );
}
export function grade(
  type: string,
  value: unknown,
  solution: unknown,
  marks: number,
  negative = 0,
): number | null {
  if (
    !["MCQ", "MULTI_SELECT", "TRUE_FALSE", "NUMERIC", "FILL_BLANK"].includes(
      type,
    )
  )
    return null;
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  )
    return 0;
  let correct = false;
  if (type === "MULTI_SELECT")
    correct =
      canonical(Array.isArray(value) ? [...value].sort() : value) ===
      canonical(Array.isArray(solution) ? [...solution].sort() : solution);
  else if (type === "NUMERIC")
    correct =
      Number.isFinite(Number(value)) &&
      Math.abs(Number(value) - Number(solution)) < 1e-6;
  else
    correct =
      String(value).trim().toLowerCase() ===
      String(solution).trim().toLowerCase();
  return correct ? marks : -negative;
}
export function csv(rows: unknown[][]) {
  return rows
    .map((row) =>
      row
        .map(
          (v) =>
            '"' +
            String(v ?? "")
              .replace(/^[\s]*[=+@\-\t\r]/, "'$&")
              .replaceAll('"', '""') +
            '"',
        )
        .join(","),
    )
    .join("\r\n");
}
