/**
 * Camera checks that run entirely in the student's browser (no images leave
 * the device and no AI API is called, so there are no rate limits). Uses the
 * open MediaPipe EfficientDet-Lite2 object detector, served from
 * /models/efficientdet_lite2.tflite, to spot a phone, an extra screen, extra
 * people, or nobody in front of the camera.
 */
import type { ObjectDetector } from "@mediapipe/tasks-vision";

let detector: Promise<ObjectDetector> | null = null;

/** Load once per page; call early (pre-exam checks) so it is ready in time. */
export function loadOnDeviceDetector() {
  detector ??= (async () => {
    const { FilesetResolver, ObjectDetector } =
      await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const create = (delegate: "GPU" | "CPU") =>
      ObjectDetector.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/models/efficientdet_lite2.tflite",
          delegate,
        },
        scoreThreshold: 0.2,
        maxResults: 20,
        runningMode: "VIDEO",
      });
    return create("GPU").catch(() => create("CPU"));
  })().catch((error) => {
    detector = null; // allow a later retry
    throw error;
  });
  return detector;
}

export type CameraFindings = {
  phone: boolean;
  /** A weaker phone-like detection worth confirming with the cloud check. */
  possiblePhone: boolean;
  extraScreen: boolean;
  people: number;
  labels: string[];
};

/** Look at one camera frame. Thresholds favour clear evidence over guesses. */
export function inspectCameraFrame(
  model: ObjectDetector,
  video: HTMLVideoElement,
): CameraFindings {
  const result = model.detectForVideo(video, performance.now());
  const top = result.detections.map((detection) => ({
    name: detection.categories[0]?.categoryName ?? "",
    score: detection.categories[0]?.score ?? 0,
  }));
  const best = (name: string) =>
    Math.max(
      0,
      ...top.filter((item) => item.name === name).map((item) => item.score),
    );
  const phoneScore = best("cell phone");
  return {
    phone: phoneScore >= 0.35,
    possiblePhone: phoneScore >= 0.2 && phoneScore < 0.35,
    extraScreen: best("laptop") >= 0.55 || best("tv") >= 0.55,
    people: top.filter((item) => item.name === "person" && item.score >= 0.45)
      .length,
    labels: top
      .filter((item) => item.score >= 0.3)
      .map((item) => `${item.name} ${Math.round(item.score * 100)}%`),
  };
}

/** Decide warnings from consecutive frames, with a cooldown per warning type. */
export function createCameraJudge(options?: {
  cooldownMs?: number;
  now?: () => number;
}) {
  const cooldownMs = options?.cooldownMs ?? 30_000;
  const now = options?.now ?? Date.now;
  const streak = { phone: 0, screen: 0, crowd: 0, empty: 0 };
  const phoneHistory: boolean[] = [];
  const possibleHistory: boolean[] = [];
  const lastWarning: Record<string, number> = {};
  const fire = (type: string) => {
    if (now() - (lastWarning[type] ?? -Infinity) < cooldownMs) return false;
    lastWarning[type] = now();
    return true;
  };
  return (findings: CameraFindings) => {
    phoneHistory.push(findings.phone);
    possibleHistory.push(findings.phone || findings.possiblePhone);
    if (phoneHistory.length > 3) phoneHistory.shift();
    if (possibleHistory.length > 3) possibleHistory.shift();
    // A phone in 2 of the last 3 frames (a hand can briefly hide it).
    streak.phone = phoneHistory.filter(Boolean).length;
    streak.screen = findings.extraScreen ? streak.screen + 1 : 0;
    streak.crowd = findings.people >= 2 ? streak.crowd + 1 : 0;
    streak.empty = findings.people === 0 ? streak.empty + 1 : 0;
    const warnings: {
      type:
        | "AI_PHONE_VISIBLE"
        | "AI_MULTIPLE_FACES_VISIBLE"
        | "AI_FACE_NOT_VISIBLE";
      reason: string;
    }[] = [];
    // Phone/screen: 2 of the last 3 frames (about 3 s at one check every 1.5 s).
    if ((streak.phone >= 2 || streak.screen >= 2) && fire("AI_PHONE_VISIBLE"))
      warnings.push({
        type: "AI_PHONE_VISIBLE",
        reason:
          streak.phone >= 2
            ? "a phone is visible in the camera"
            : "an extra screen is visible in the camera",
      });
    if (streak.crowd >= 2 && fire("AI_MULTIPLE_FACES_VISIBLE"))
      warnings.push({
        type: "AI_MULTIPLE_FACES_VISIBLE",
        reason: "more than one person is visible in the camera",
      });
    // Three frames in a row (about 6 s) so a brief lean away is not penalised.
    if (streak.empty >= 3 && fire("AI_FACE_NOT_VISIBLE"))
      warnings.push({
        type: "AI_FACE_NOT_VISIBLE",
        reason: "no person is visible in the camera",
      });
    // Borderline phone sightings: ask the cloud check to confirm.
    const confirmPhone =
      !warnings.some((warning) => warning.type === "AI_PHONE_VISIBLE") &&
      possibleHistory.filter(Boolean).length >= 2 &&
      now() - (lastWarning.AI_PHONE_VISIBLE ?? -Infinity) >= cooldownMs;
    return { warnings, confirmPhone };
  };
}

/**
 * Voice detection from microphone frequency data: speech-band (300–3400 Hz)
 * energy that clearly exceeds the room's background level and dominates the
 * spectrum, sustained for about 3 s. Call every 500 ms.
 */
export function createVoiceJudge(options?: {
  cooldownMs?: number;
  now?: () => number;
}) {
  const cooldownMs = options?.cooldownMs ?? 30_000;
  const now = options?.now ?? Date.now;
  const recent: boolean[] = [];
  // Background (non-voice) level. Start quiet and only drift upward slowly, so
  // a student already talking when checks begin is still detected.
  let noise = 0.05;
  let lastWarning = -Infinity;
  return (spectrum: Uint8Array, sampleRate: number) => {
    const binHz = sampleRate / 2 / spectrum.length;
    let voice = 0,
      total = 0,
      voiceBins = 0;
    for (let index = 0; index < spectrum.length; index++) {
      const power = (spectrum[index] / 255) ** 2;
      total += power;
      const hz = index * binHz;
      if (hz >= 300 && hz <= 3400) {
        voice += power;
        voiceBins++;
      }
    }
    const level = Math.sqrt(voice / Math.max(1, voiceBins));
    const ratio = total ? voice / total : 0;
    const voiceLike = level > Math.max(0.18, noise * 1.8) && ratio > 0.55;
    if (!voiceLike) noise = noise * 0.95 + level * 0.05;
    recent.push(voiceLike);
    if (recent.length > 8) recent.shift();
    const sustained = recent.filter(Boolean).length >= 6;
    if (sustained && now() - lastWarning >= cooldownMs) {
      lastWarning = now();
      recent.length = 0;
      return true;
    }
    return false;
  };
}
