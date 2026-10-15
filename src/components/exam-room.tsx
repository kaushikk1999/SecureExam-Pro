/* eslint-disable @next/next/no-img-element -- Authenticated private exam images must bypass the public image cache. */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { loader } from "@monaco-editor/react";
import { get, set, del } from "idb-keyval";
import {
  ShieldCheck,
  Camera,
  Mic,
  MapPin,
  Maximize2,
  Wifi,
  CheckCircle2,
  AlertTriangle,
  Clock3,
  Flag,
  ChevronLeft,
  ChevronRight,
  Send,
} from "lucide-react";
import type { Actor } from "@/lib/auth";
import {
  classifyExamDevice,
  examFullscreenRequired,
  examFullscreenSatisfied,
  examScreenSharingRequired,
  screenSharePreflightSatisfied,
  type ExamDeviceClass,
} from "@/lib/exam-device";
import { api, Markdown, ErrorBox, Loading, time } from "./ui";
import { Upload } from "./workspace";
const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
loader.config({ paths: { vs: "/monaco/vs" } });
type QueuedAnswer = { questionId: string; value: any; version: number };
type QueuedEvent = { id: string; type: string; metadata: Record<string, any> };
function captureTrackIsActive(track?: MediaStreamTrack) {
  return (
    !!track && track.readyState === "live" && track.enabled && !track.muted
  );
}
function readBestLocation(maxAccuracy: number) {
  return new Promise<{ latitude: number; longitude: number; accuracy: number }>(
    (resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Location detection is unavailable in this browser."));
        return;
      }
      let best: {
          latitude: number;
          longitude: number;
          accuracy: number;
        } | null = null,
        settled = false;
      const watchId: { current?: number } = {};
      const finish = (error?: GeolocationPositionError) => {
        if (settled) return;
        settled = true;
        if (watchId.current !== undefined)
          navigator.geolocation.clearWatch(watchId.current);
        clearTimeout(timer);
        if (best) resolve(best);
        else
          reject(
            new Error(
              error?.message ||
                "Could not get your location. Allow location access and try again.",
            ),
          );
      };
      const timer = setTimeout(() => finish(), 15000);
      watchId.current = navigator.geolocation.watchPosition(
        ({ coords }) => {
          const reading = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
          };
          if (!best || reading.accuracy < best.accuracy) best = reading;
          if (reading.accuracy <= maxAccuracy) finish();
        },
        (error) => finish(error),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    },
  );
}
export default function ExamRoom({
  examId,
  enrollmentToken,
  enrollmentInviteIssuedAt,
  user,
}: {
  examId: string;
  enrollmentToken: string | null;
  enrollmentInviteIssuedAt: string | null;
  user: Actor;
}) {
  const [exam, setExam] = useState<any>(null),
    [attempt, setAttempt] = useState<any>(null),
    [existing, setExisting] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checks, setChecks] = useState({
      camera: false,
      microphone: false,
      screen: false,
      fullscreen: false,
    }),
    [deviceClass, setDeviceClass] = useState<ExamDeviceClass>("unsupported"),
    [accepted, setAccepted] = useState(false),
    [aiCameraAccepted, setAiCameraAccepted] = useState(false),
    [cameraEvidenceAccepted, setCameraEvidenceAccepted] = useState(false),
    [studentId, setStudentId] = useState(user.student_id ?? ""),
    [identitySaved, setIdentitySaved] = useState(!!user.student_id),
    [identityConfirmed, setIdentityConfirmed] = useState(false),
    [identitySaving, setIdentitySaving] = useState(false),
    [code, setCode] = useState(""),
    [point, setPoint] = useState<any>(null),
    [permissionReady, setPermissionReady] = useState(false),
    [screenShareUnsupported, setScreenShareUnsupported] = useState(false),
    [screenSurface, setScreenSurface] = useState<string | undefined>(),
    [index, setIndex] = useState(0),
    [values, setValues] = useState<Record<string, any>>({}),
    [flagged, setFlagged] = useState<string[]>([]),
    [saveStatus, setSaveStatus] = useState("All answers saved"),
    [online, setOnline] = useState(true),
    [warning, setWarning] = useState(""),
    [tabHold, setTabHold] = useState(false),
    [seconds, setSeconds] = useState(0),
    [clockNow, setClockNow] = useState(0),
    [fullscreen, setFullscreen] = useState(true);
  const device = useRef(""),
    stream = useRef<MediaStream | null>(null),
    microphoneAudio = useRef<{
      context: AudioContext;
      analyser: AnalyserNode;
    } | null>(null),
    screenStream = useRef<MediaStream | null>(null),
    screenCaptureVideo = useRef<HTMLVideoElement | null>(null),
    video = useRef<HTMLVideoElement | null>(null),
    active = useRef<any>(null),
    answers = useRef<Record<string, QueuedAnswer>>({}),
    events = useRef<QueuedEvent[]>([]),
    versions = useRef<Record<string, number>>({}),
    lastEvent = useRef<Record<string, number>>({}),
    lastEvidenceCapture = useRef(0),
    syncing = useRef(false),
    location = useRef<any>(null),
    anchor = useRef({ remaining: 0, at: 0 }),
    debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = "exam-draft:" + user.id + ":" + examId;
  useEffect(() => {
    if (!exam || attempt) return;
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [exam, attempt]);
  const headers = () => ({ "x-exam-device": device.current });
  const persist = useCallback(
    () => set(key, { answers: answers.current, events: events.current }),
    [key],
  );
  const alert = useCallback((text: string) => {
    setWarning(text);
    try {
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      gain.gain.value = 0.06;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.18);
      oscillator.onended = () => void ctx.close();
    } catch {}
  }, []);
  const synchronize = useCallback(
    async function synchronizeBatch(submit = false): Promise<void> {
      if (
        syncing.current ||
        !active.current ||
        active.current.status !== "ACTIVE"
      )
        return;
      syncing.current = true;
      const pending = Object.values(answers.current),
        queued = events.current.slice(0, 30);
      try {
        const result = await api(
          `attempts/${active.current.id}/${submit ? "submit" : "sync"}`,
          {
            answers: pending,
            events: queued,
            deviceState: {
              camera: !!stream.current
                ?.getVideoTracks()
                .some((t) => t.readyState === "live" && t.enabled),
              microphone: !!stream.current
                ?.getAudioTracks()
                .some((t) => t.readyState === "live" && t.enabled),
              screen: !!screenStream.current
                ?.getVideoTracks()
                .some(captureTrackIsActive),
              screenShareUnavailable: screenShareUnsupported,
              deviceClass,
              fullscreen:
                !examFullscreenRequired(
                  active.current.policy.fullscreen,
                  deviceClass,
                ) || !!document.fullscreenElement,
              online: navigator.onLine,
            },
          },
          "POST",
          { "x-exam-device": device.current },
        );
        if (result.answersAccepted) {
          for (const a of pending)
            if (answers.current[a.questionId]?.version === a.version)
              delete answers.current[a.questionId];
          events.current = events.current.filter(
            (e) => !queued.some((q) => q.id === e.id),
          );
        }
        if (result.warnings > active.current.warnings)
          alert(
            `Warning ${result.warnings} of ${active.current.policy.maxWarnings}. A monitored security rule was triggered. Restore the required examination conditions. Your instructor can review this event.`,
          );
        active.current = { ...active.current, ...result };
        setAttempt(active.current);
        anchor.current = {
          remaining:
            result.remainingMs ??
            Math.max(
              0,
              new Date(result.deadline).getTime() -
                new Date(result.serverTime).getTime(),
            ),
          at: performance.now(),
        };
        setOnline(true);
        setSaveStatus(
          Object.keys(answers.current).length
            ? "Waiting to save…"
            : "All answers saved",
        );
        await persist();
        if (
          result.answersAccepted &&
          result.status === "ACTIVE" &&
          (events.current.length || Object.keys(answers.current).length)
        )
          setTimeout(() => void synchronizeBatch(), 0);
        if (result.status !== "ACTIVE") {
          if (!Object.keys(answers.current).length) await del(key);
          stream.current?.getTracks().forEach((t) => t.stop());
          screenStream.current?.getTracks().forEach((t) => t.stop());
          if (screenCaptureVideo.current) {
            screenCaptureVideo.current.pause();
            screenCaptureVideo.current.srcObject = null;
            screenCaptureVideo.current = null;
          }
          void microphoneAudio.current?.context.close();
          microphoneAudio.current = null;
          if (document.fullscreenElement) void document.exitFullscreen();
        }
      } catch (e) {
        setOnline(navigator.onLine);
        setSaveStatus("Not synchronized · draft saved on this device");
        setError((e as Error).message);
        await persist();
      } finally {
        syncing.current = false;
      }
    },
    [alert, deviceClass, key, persist, screenShareUnsupported],
  );
  const captureScreenEvidence = useCallback(
    async (eventId: string, type: string) => {
      const track = screenStream.current
        ?.getVideoTracks()
        .find(captureTrackIsActive);
      const sharedScreen = screenCaptureVideo.current;
      const cameraTrack = stream.current
        ?.getVideoTracks()
        .find(captureTrackIsActive);
      const cameraSource = video.current;
      const useCameraStill =
        deviceClass === "tablet" &&
        active.current?.policy.camera &&
        !!cameraTrack &&
        !!cameraSource &&
        cameraSource.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const source =
        track && sharedScreen?.readyState === HTMLMediaElement.HAVE_CURRENT_DATA
          ? sharedScreen
          : useCameraStill
            ? cameraSource
            : null;
      if (!source) return null;
      const captureType =
        useCameraStill && source === cameraSource
          ? "tablet camera still"
          : "shared screen snapshot";
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = captureType === "tablet camera still" ? 480 : 360;
      const context = canvas.getContext("2d");
      if (!context) return null;
      const capturedAt = new Date().toISOString();
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.52),
      );
      if (!blob || blob.size > 150_000) return null;
      const form = new FormData();
      form.append("file", blob, `${eventId}.jpg`);
      form.append("examId", examId);
      form.append("attemptId", active.current.id);
      form.append("eventEvidence", "true");
      form.append("eventId", eventId);
      form.append("eventType", type);
      const response = await fetch("/api/platform/files", {
        method: "POST",
        headers: headers(),
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Evidence upload failed.");
      return {
        id: String(result.id),
        captureType,
        capturedAt,
        storageFallback: result.storageFallback === true,
      };
    },
    [deviceClass, examId],
  );
  const emit = useCallback(
    (type: string, metadata: Record<string, any> = {}) => {
      if (
        active.current?.status !== "ACTIVE" ||
        active.current.examStatus === "PAUSED"
      )
        return;
      const now = performance.now();
      if (["TAB_HIDDEN", "WINDOW_BLUR", "FULLSCREEN_EXIT"].includes(type)) {
        if (now - (lastEvent.current[type] ?? -Infinity) < 1000) return;
        lastEvent.current[type] = now;
      }
      const id = crypto.randomUUID();
      const observedAt = new Date().toISOString();
      const recordEvent = (extra: Record<string, any> = {}) => {
        events.current.push({
          id,
          type,
          metadata: {
            ...metadata,
            ...extra,
            clientObservedAt: observedAt,
          },
        });
        void persist();
        void synchronize();
      };
      const evidenceTypes = [
        "TAB_HIDDEN",
        "WINDOW_BLUR",
        "FULLSCREEN_EXIT",
        "CAMERA_DISABLED",
        "MICROPHONE_DISABLED",
        "SCREEN_SHARE_STOPPED",
        "LOCATION_OUTSIDE_GEOFENCE",
        "PASTE_ATTEMPT",
        "SPEECH_ACTIVITY",
        "CAMERA_MOTION",
        "AI_FACE_NOT_VISIBLE",
      ];
      const nowMs = Date.now();
      const tabletCameraEvidenceEnabled =
        deviceClass === "tablet" &&
        active.current.policy?.camera &&
        active.current.cameraEvidenceAccepted;
      if (
        (active.current.policy.screen || tabletCameraEvidenceEnabled) &&
        evidenceTypes.includes(type) &&
        (type === "AI_FACE_NOT_VISIBLE" ||
          nowMs - lastEvidenceCapture.current >= 5000)
      ) {
        lastEvidenceCapture.current = nowMs;
        void captureScreenEvidence(id, type)
          .then((evidence) =>
            recordEvent(
              evidence
                ? {
                    evidenceFileId: evidence.id,
                    evidenceCapture: evidence.captureType,
                    evidenceCapturedAt: evidence.capturedAt,
                    evidenceStorageFallback: evidence.storageFallback,
                  }
                : {
                    evidenceCapture: "unavailable",
                    evidenceCapturedAt: new Date().toISOString(),
                  },
            ),
          )
          .catch(() =>
            recordEvent({
              evidenceCapture: "unavailable",
              evidenceCapturedAt: new Date().toISOString(),
            }),
          );
        return;
      }
      recordEvent();
    },
    [captureScreenEvidence, deviceClass, persist, synchronize],
  );
  useEffect(() => {
    device.current = sessionStorage.getItem("exam-device:" + examId) ?? "";
    if (!device.current)
      void api("me/device", {})
        .then((d) => {
          device.current = d.id;
          sessionStorage.setItem("exam-device:" + examId, d.id);
        })
        .catch((e) => setError(e.message));
    setOnline(navigator.onLine);
    const browserNavigator = navigator as Navigator & {
      userAgentData?: { mobile?: boolean };
    };
    const detectedDeviceClass = classifyExamDevice({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      minScreenDimension: Math.min(screen.width, screen.height),
      mobileHint: browserNavigator.userAgentData?.mobile,
    });
    setDeviceClass(detectedDeviceClass);
    setScreenShareUnsupported(
      detectedDeviceClass === "laptop" &&
        typeof navigator.mediaDevices?.getDisplayMedia !== "function",
    );
    setChecks((c) => ({
      ...c,
      fullscreen:
        detectedDeviceClass === "tablet" || document.fullscreenEnabled,
    }));
    async function loadExam() {
      if (enrollmentToken && enrollmentInviteIssuedAt) {
        await api(`exams/${examId}/self-enroll`, {
          token: enrollmentToken,
          issuedAt: Number(enrollmentInviteIssuedAt),
        });
      } else if (enrollmentToken) {
        const enrolledExams = await api("exams");
        if (!enrolledExams.some((item: any) => item.id === examId))
          throw new Error(
            "This exam QR code is outdated. Ask your instructor to display a fresh QR code.",
          );
      }
      const [e, list] = await Promise.all([
        api("exams/" + examId),
        api("exams"),
      ]);
      setExam(e);
      setExisting(list.find((x: any) => x.id === examId && x.attempt_id));
    }
    void loadExam().catch((e) => setError(e.message));
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      screenStream.current?.getTracks().forEach((t) => t.stop());
      if (screenCaptureVideo.current) {
        screenCaptureVideo.current.pause();
        screenCaptureVideo.current.srcObject = null;
        screenCaptureVideo.current = null;
      }
      void microphoneAudio.current?.context.close();
      microphoneAudio.current = null;
    };
  }, [examId, enrollmentToken, enrollmentInviteIssuedAt]);
  useEffect(() => {
    if (video.current && stream.current)
      video.current.srcObject = stream.current;
  }, [permissionReady, attempt]);
  async function loadAttempt(id: string) {
    const a = await api("attempts/" + id, undefined, "GET", headers());
    const local = await get(key);
    const v: Record<string, any> = {};
    for (const answer of a.answers) {
      v[answer.question_id] = answer.value;
      versions.current[answer.question_id] = answer.version;
    }
    if (a.status === "ACTIVE" && local) {
      answers.current = local.answers ?? {};
      events.current = local.events ?? [];
      for (const ans of Object.values(answers.current) as QueuedAnswer[]) {
        if (ans.version > (versions.current[ans.questionId] ?? 0)) {
          v[ans.questionId] = ans.value;
          versions.current[ans.questionId] = ans.version;
        } else delete answers.current[ans.questionId];
      }
    }
    setValues(v);
    active.current = a;
    setAttempt(a);
    setSeconds(
      Math.ceil(
        (a.remainingMs ??
          Math.max(
            0,
            new Date(a.deadline).getTime() - new Date(a.serverTime).getTime(),
          )) / 1000,
      ),
    );
    anchor.current = {
      remaining: Math.max(
        0,
        new Date(a.deadline).getTime() - new Date(a.serverTime).getTime(),
      ),
      at: performance.now(),
    };
    setError("");
  }
  useEffect(() => {
    if (existing && existing.attempt_status !== "ACTIVE")
      void loadAttempt(existing.attempt_id).catch((e) => setError(e.message)); // Results never need device permissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);
  async function permissions() {
    setBusy(true);
    setError("");
    let verifiedScreenSurface: string | undefined;
    screenStream.current?.getTracks().forEach((track) => track.stop());
    screenStream.current = null;
    setScreenSurface(undefined);
    setScreenShareUnsupported(false);
    try {
      const p = exam.policy;
      stream.current?.getTracks().forEach((t) => t.stop());
      void microphoneAudio.current?.context.close();
      microphoneAudio.current = null;
      if (p.camera || p.microphone) {
        stream.current = await navigator.mediaDevices.getUserMedia({
          video: p.camera,
          audio: p.microphone,
        });
        for (const track of stream.current.getTracks()) {
          const eventType =
            track.kind === "video" ? "CAMERA_DISABLED" : "MICROPHONE_DISABLED";
          const updateTrackStatus = () =>
            setChecks((current) => ({
              ...current,
              camera:
                stream.current?.getVideoTracks().some(captureTrackIsActive) ??
                false,
              microphone:
                stream.current?.getAudioTracks().some(captureTrackIsActive) ??
                false,
            }));
          track.onended = () => {
            updateTrackStatus();
            emit(eventType);
            alert(
              track.kind === "video"
                ? "Camera turned off. Restore camera access to continue the exam."
                : "Microphone turned off. Restore microphone access to continue the exam.",
            );
          };
          track.onmute = () => {
            updateTrackStatus();
            setTimeout(() => {
              if (track.muted) {
                emit(eventType);
                alert(
                  track.kind === "video"
                    ? "Camera signal is unavailable. Check that your camera remains on and unobstructed."
                    : "Microphone signal is unavailable. Check that your microphone remains on and unobstructed.",
                );
              }
            }, 3000);
          };
          track.onunmute = updateTrackStatus;
        }
        if (p.microphone) {
          const audioTrack = stream.current
            .getAudioTracks()
            .find(captureTrackIsActive);
          if (!audioTrack)
            throw new Error(
              "Microphone is not active. Allow microphone access, check that it is not muted, then run the device checks again.",
            );
          const context = new AudioContext();
          await context.resume();
          const analyser = context.createAnalyser();
          analyser.fftSize = 512;
          context.createMediaStreamSource(stream.current).connect(analyser);
          microphoneAudio.current = { context, analyser };
        }
      }
      if (examScreenSharingRequired(p.screen, deviceClass)) {
        const getDisplayMedia = navigator.mediaDevices?.getDisplayMedia;
        if (typeof getDisplayMedia !== "function") {
          setScreenShareUnsupported(true);
          throw new Error(
            "This browser cannot share the entire screen. Use a browser/device that supports full-screen capture; this exam cannot start without it.",
          );
        } else {
          try {
            const capture = await getDisplayMedia.call(navigator.mediaDevices, {
              video: { displaySurface: "monitor" },
              audio: false,
              monitorTypeSurfaces: "include",
              selfBrowserSurface: "exclude",
              preferCurrentTab: false,
            } as DisplayMediaStreamOptions);
            const captureTrack = capture.getVideoTracks()[0];
            const selectedSurface = captureTrack?.getSettings().displaySurface;
            if (!captureTrack || selectedSurface !== "monitor") {
              capture.getTracks().forEach((track) => track.stop());
              setScreenShareUnsupported(true);
              setScreenSurface(selectedSurface);
              throw new Error(
                selectedSurface === "browser"
                  ? "You shared a browser tab. Run the checks again and choose Entire screen in the browser's sharing dialog."
                  : selectedSurface === "window"
                    ? "You shared a window. Run the checks again and choose Entire screen in the browser's sharing dialog."
                    : "The browser did not confirm that you shared the entire screen. Choose Entire screen, or use a browser that can verify full-screen sharing.",
              );
            }
            screenStream.current = capture;
            verifiedScreenSurface = selectedSurface;
            setScreenSurface(selectedSurface);
            setScreenShareUnsupported(false);
            const captureVideo = document.createElement("video");
            captureVideo.muted = true;
            captureVideo.playsInline = true;
            captureVideo.srcObject = screenStream.current;
            screenCaptureVideo.current = captureVideo;
            void captureVideo.play().catch(() => undefined);
            capture.getVideoTracks().forEach((t) => {
              t.onended = () => {
                setChecks((current) => ({ ...current, screen: false }));
                emit("SCREEN_SHARE_STOPPED");
              };
            });
          } catch (error) {
            setScreenShareUnsupported(true);
            if (
              (error as Error)?.message?.includes("choose Entire screen") ||
              (error as Error)?.message?.includes("did not confirm")
            )
              throw error;
            if ((error as DOMException)?.name === "NotAllowedError")
              throw new Error(
                "Screen sharing was canceled or blocked. Run the checks again, choose Entire screen, and approve sharing. This exam cannot start until sharing succeeds.",
              );
            throw new Error(
              "Full-screen sharing is unavailable in this browser/device. This exam cannot start without it; use a compatible browser and device.",
            );
          }
        }
      }
      if (p.location) {
        const maximumAccuracy = Math.max(
          100,
          Number(exam.classroom?.accuracy ?? 0),
          Number(exam.classroom?.radius ?? 0),
        );
        const loc = await readBestLocation(maximumAccuracy);
        location.current = loc;
        setPoint(loc);
      }
      setChecks((c) => ({
        ...c,
        camera:
          stream.current?.getVideoTracks().some(captureTrackIsActive) ?? false,
        microphone:
          stream.current?.getAudioTracks().some(captureTrackIsActive) ?? false,
        screen:
          !examScreenSharingRequired(p.screen, deviceClass) ||
          screenSharePreflightSatisfied(
            true,
            screenStream.current?.getVideoTracks().some(captureTrackIsActive) ??
              false,
            verifiedScreenSurface,
          ),
      }));
      setPermissionReady(true);
    } catch (e) {
      stream.current?.getTracks().forEach((track) => track.stop());
      screenStream.current?.getTracks().forEach((track) => track.stop());
      if (screenCaptureVideo.current) {
        screenCaptureVideo.current.pause();
        screenCaptureVideo.current.srcObject = null;
        screenCaptureVideo.current = null;
      }
      void microphoneAudio.current?.context.close();
      microphoneAudio.current = null;
      setChecks((current) => ({
        ...current,
        camera: false,
        microphone: false,
        screen: false,
      }));
      setScreenSurface(undefined);
      setPermissionReady(false);
      setError(
        (e as Error).message || "A required device permission was unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function begin() {
    setBusy(true);
    setError("");
    try {
      if (examFullscreenRequired(exam.policy.fullscreen, deviceClass))
        await document.documentElement.requestFullscreen();
      const result = await api(`exams/${examId}/start`, {
        deviceSessionId: device.current,
        deviceClass,
        accepted,
        aiCameraAccepted,
        cameraEvidenceAccepted,
        checks: {
          ...checks,
          fullscreen:
            !examFullscreenRequired(exam.policy.fullscreen, deviceClass) ||
            !!document.fullscreenElement,
        },
        screenShareUnavailable:
          screenShareUnsupported && deviceClass === "laptop",
        code,
        location: point,
      });
      await loadAttempt(result.id);
      active.current = {
        ...active.current,
        cameraEvidenceAccepted,
      };
    } catch (e) {
      setError((e as Error).message);
      if (document.fullscreenElement) void document.exitFullscreen();
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!attempt?.id || attempt.status !== "ACTIVE") return;
    const tick = setInterval(() => {
      const remaining =
        active.current?.examStatus === "PAUSED"
          ? anchor.current.remaining
          : Math.max(
              0,
              anchor.current.remaining -
                (performance.now() - anchor.current.at),
            );
      setSeconds(Math.ceil(remaining / 1000));
      if (remaining === 0) void synchronize();
    }, 1000);
    const heartbeat = setInterval(() => void synchronize(), 15000);
    const updates = setInterval(async () => {
      try {
        const a = await api("attempts/" + active.current.id, undefined, "GET", {
          "x-exam-device": device.current,
        });
        if (a.warnings > active.current.warnings)
          alert(
            `Warning ${a.warnings} of ${a.policy.maxWarnings}. Please restore examination conditions.`,
          );
        active.current = { ...active.current, ...a };
        setAttempt(active.current);
        anchor.current = {
          remaining:
            a.remainingMs ??
            Math.max(
              0,
              new Date(a.deadline).getTime() - new Date(a.serverTime).getTime(),
            ),
          at: performance.now(),
        };
        if (a.status !== "ACTIVE") {
          if (!Object.keys(answers.current).length) await del(key);
          stream.current?.getTracks().forEach((t) => t.stop());
          screenStream.current?.getTracks().forEach((t) => t.stop());
          if (screenCaptureVideo.current) {
            screenCaptureVideo.current.pause();
            screenCaptureVideo.current.srcObject = null;
            screenCaptureVideo.current = null;
          }
          void microphoneAudio.current?.context.close();
          microphoneAudio.current = null;
        }
      } catch {
        /* Sync reports connection errors and retains local drafts. */
      }
    }, 10000);
    const visibility = () => {
      if (document.hidden) {
        if (active.current?.policy.tabMonitoring) {
          setTabHold(true);
          alert(
            "Exam tab changed. Return to the examination and acknowledge this signal to continue.",
          );
        }
        emit("TAB_HIDDEN");
      } else if (events.current.length) {
        void synchronize();
      }
    };
    const blur = () => {
      if (document.activeElement?.tagName !== "IFRAME") emit("WINDOW_BLUR");
    };
    const full = () => {
      if (
        !examFullscreenRequired(
          active.current?.policy.fullscreen ?? false,
          deviceClass,
        )
      ) {
        setFullscreen(true);
        return;
      }
      setFullscreen(!!document.fullscreenElement);
      if (!document.fullscreenElement) emit("FULLSCREEN_EXIT");
    };
    const off = () => {
      setOnline(false);
      emit("NETWORK_DISCONNECTED");
    };
    const on = () => {
      setOnline(true);
      emit("NETWORK_RECONNECTED");
      void synchronize();
    };
    const focus = () => {
      if (events.current.length) void synchronize();
    };
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const paste = (e: ClipboardEvent) => {
      if (!active.current.policy.allowPaste) {
        e.preventDefault();
        emit("PASTE_ATTEMPT");
      }
    };
    const copy = (e: ClipboardEvent) => {
      if (!active.current.policy.allowCopy) e.preventDefault();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("fullscreenchange", full);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    window.addEventListener("beforeunload", leave);
    document.addEventListener("paste", paste);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", copy);
    let speechTimer: ReturnType<typeof setInterval> | undefined;
    let motionTimer: ReturnType<typeof setInterval> | undefined;
    let visionTimer: ReturnType<typeof setInterval> | undefined;
    let visionBusy = false;
    let lastVisionNotice = 0;
    const analyser = microphoneAudio.current?.analyser;
    if (attempt.policy.microphone && analyser) {
      const audioSamples = new Uint8Array(analyser.fftSize);
      let speechWindows = 0;
      let lastSpeechSignal = 0;
      speechTimer = setInterval(() => {
        if (active.current?.status !== "ACTIVE") return;
        analyser.getByteTimeDomainData(audioSamples);
        let energy = 0;
        for (const sample of audioSamples) {
          const normalized = (sample - 128) / 128;
          energy += normalized * normalized;
        }
        const rms = Math.sqrt(energy / audioSamples.length);
        speechWindows = rms > 0.045 ? speechWindows + 1 : 0;
        if (speechWindows >= 8 && Date.now() - lastSpeechSignal > 60000) {
          speechWindows = 0;
          lastSpeechSignal = Date.now();
          alert(
            "Sustained microphone sound was detected. This sound-level signal cannot identify speech or conversation. Remain quiet if required; your instructor can review the signal.",
          );
          emit("SPEECH_ACTIVITY", {
            sustainedSeconds: 4,
            measurement: "on-device audio level only",
          });
        }
      }, 500);
    }
    if (attempt.policy.camera && video.current) {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 24;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      let previous: Uint8ClampedArray | null = null;
      let changingWindows = 0;
      let lastMotionSignal = 0;
      if (context) {
        motionTimer = setInterval(() => {
          const camera = video.current;
          if (
            !camera ||
            camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            active.current?.status !== "ACTIVE"
          )
            return;
          try {
            context.drawImage(camera, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            if (previous) {
              let changed = 0;
              for (let offset = 0; offset < pixels.length; offset += 4) {
                const currentLuma =
                  (pixels[offset] * 3 +
                    pixels[offset + 1] * 6 +
                    pixels[offset + 2]) /
                  10;
                const priorLuma =
                  (previous[offset] * 3 +
                    previous[offset + 1] * 6 +
                    previous[offset + 2]) /
                  10;
                if (Math.abs(currentLuma - priorLuma) > 35) changed++;
              }
              const changePercent = Math.round(
                (changed / (pixels.length / 4)) * 100,
              );
              changingWindows = changePercent > 25 ? changingWindows + 1 : 0;
              if (
                changingWindows >= 3 &&
                Date.now() - lastMotionSignal > 60000
              ) {
                changingWindows = 0;
                lastMotionSignal = Date.now();
                alert(
                  "Repeated camera-frame movement detected. Keep your face and workspace in view if possible. Normal movement can trigger this signal; your instructor will review it.",
                );
                emit("CAMERA_MOTION", {
                  changePercent,
                  measurement: "coarse on-device frame difference",
                });
              }
            }
            previous = new Uint8ClampedArray(pixels);
          } catch {
            /* Camera frame analysis stays local and may be unavailable. */
          }
        }, 1000);
      }
    }
    if (attempt.policy.aiCameraMonitoring && attempt.policy.camera) {
      const captureFrame = async () => {
        const camera = video.current;
        if (
          !camera ||
          camera.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          active.current?.status !== "ACTIVE"
        )
          return null;
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 192;
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.drawImage(camera, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.45),
        );
        if (!blob || blob.size > 100_000) return null;
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () =>
            reject(new Error("Could not read camera sample."));
          reader.onload = () =>
            resolve(String(reader.result).split(",", 2)[1] ?? "");
          reader.readAsDataURL(blob);
        });
      };
      const reviewCamera = async () => {
        if (visionBusy || active.current?.status !== "ACTIVE") return;
        visionBusy = true;
        try {
          const first = await captureFrame();
          if (!first) return;
          await new Promise((resolve) => setTimeout(resolve, 1800));
          const second = await captureFrame();
          if (!second || active.current?.status !== "ACTIVE") return;
          const result = await api(
            `attempts/${attempt.id}/vision-review`,
            { frames: [first, second] },
            "POST",
            { "x-exam-device": device.current },
          );
          const signals: string[] = result.signals ?? [];
          if (!signals.length) return;
          const faceMissing = signals.includes("FACE_NOT_VISIBLE");
          if (faceMissing)
            emit("AI_FACE_NOT_VISIBLE", {
              signals: "FACE_NOT_VISIBLE",
              measurement:
                "Ollama review of two transient low-resolution camera frames; no face clearly visible in either sample",
            });
          if (Date.now() - lastVisionNotice > 30000) {
            lastVisionNotice = Date.now();
            const labels: Record<string, string> = {
              FACE_NOT_VISIBLE: "your face was not clearly visible",
              MULTIPLE_PEOPLE_VISIBLE: "two or more faces may be visible",
              POSSIBLE_PHONE_OR_EXTRA_SCREEN:
                "a phone or extra screen may be visible",
              POSSIBLE_MOUTH_MOVEMENT: "possible mouth movement was noticed",
            };
            const reasons = signals
              .map((signal) => labels[signal])
              .filter(Boolean)
              .join("; ");
            const multipleFaces = signals.includes("MULTIPLE_PEOPLE_VISIBLE");
            if (!faceMissing)
              alert(
                multipleFaces
                  ? `Warning: ${reasons}. This camera detection counts as a security warning and may lead to automatic submission when the exam's warning limit is reached. Automated signals can be mistaken; adjust your camera view. Your instructor can review the event.`
                  : `Camera review signal: ${reasons}. This signal is advisory only and does not count as a warning strike. Automated signals can be mistaken; adjust your camera view and your instructor can review the event.`,
              );
          }
        } catch {
          // Camera review is advisory and must never interrupt exam progress.
        } finally {
          visionBusy = false;
        }
      };
      visionTimer = setInterval(() => void reviewCamera(), 20000);
    }
    let watch: number | undefined;
    let locationTimer: ReturnType<typeof setInterval> | undefined,
      checkpoint: ReturnType<typeof setInterval> | undefined;
    if (attempt.policy.location) {
      watch = navigator.geolocation.watchPosition(
        (pos) => {
          const p = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          };
          location.current = p;
          setPoint(p);
        },
        () => emit("LOCATION_UNAVAILABLE"),
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
      );
      locationTimer = setInterval(() => {
        if (location.current) emit("LOCATION_CHECK", location.current);
      }, 30000);
      checkpoint = setInterval(() => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            emit("LOCATION_CHECK", {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              checkpoint: true,
            }),
          () => emit("LOCATION_UNAVAILABLE", { checkpoint: true }),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
        );
      }, 600000);
    }
    return () => {
      clearInterval(tick);
      clearInterval(heartbeat);
      clearInterval(updates);
      if (speechTimer) clearInterval(speechTimer);
      if (motionTimer) clearInterval(motionTimer);
      if (visionTimer) clearInterval(visionTimer);
      if (locationTimer) clearInterval(locationTimer);
      if (checkpoint) clearInterval(checkpoint);
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("fullscreenchange", full);
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
      window.removeEventListener("beforeunload", leave);
      document.removeEventListener("paste", paste);
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", copy);
    };
  }, [
    attempt?.id,
    attempt?.status,
    attempt?.policy.camera,
    attempt?.policy.aiCameraMonitoring,
    attempt?.policy.location,
    attempt?.policy.microphone,
    deviceClass,
    alert,
    emit,
    key,
    synchronize,
  ]);
  useEffect(() => {
    const attemptId = attempt?.id;
    if (
      !attemptId ||
      attempt.status !== "ACTIVE" ||
      !attempt.policy?.screen ||
      !screenStream.current?.getVideoTracks().some(captureTrackIsActive)
    )
      return;

    let disposed = false;
    let peer: RTCPeerConnection | null = null;
    let requestId = "";
    let sendingOffer = false;
    let pollBusy = false;
    const path = `attempts/${attemptId}/screen`;
    async function gatherIce(connection: RTCPeerConnection) {
      if (connection.iceGatheringState === "complete") return;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 8000);
        const done = () => {
          if (connection.iceGatheringState !== "complete") return;
          clearTimeout(timeout);
          connection.removeEventListener("icegatheringstatechange", done);
          resolve();
        };
        connection.addEventListener("icegatheringstatechange", done);
      });
    }
    async function poll() {
      if (pollBusy) return;
      pollBusy = true;
      try {
        const signal = await api(path, undefined, "GET", headers());
        if (disposed) return;
        if (!signal.requestId) {
          peer?.close();
          peer = null;
          requestId = "";
          return;
        }
        if (signal.requestId !== requestId) {
          peer?.close();
          peer = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
          });
          requestId = signal.requestId;
          const screenTracks = screenStream.current?.getVideoTracks() ?? [];
          for (const track of screenTracks)
            peer.addTrack(track, screenStream.current!);
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          await gatherIce(peer);
          const description = peer.localDescription;
          if (!description?.sdp)
            throw new Error("Could not prepare screen-share connection.");
          sendingOffer = true;
          await api(path + "/offer", {
            requestId,
            description: { type: description.type, sdp: description.sdp },
          });
          sendingOffer = false;
        }
        if (signal.answer && peer?.signalingState === "have-local-offer")
          await peer.setRemoteDescription(signal.answer);
      } catch {
        sendingOffer = false;
        // A dropped signaling poll should not interrupt the exam.
      } finally {
        pollBusy = false;
      }
    }
    void poll();
    const timer = setInterval(() => {
      if (!sendingOffer) void poll();
    }, 1800);
    return () => {
      disposed = true;
      clearInterval(timer);
      peer?.close();
    };
  }, [attempt?.id, attempt?.status, attempt?.policy?.screen]);
  function change(questionId: string, value: any) {
    const version = (versions.current[questionId] ?? 0) + 1;
    versions.current[questionId] = version;
    answers.current[questionId] = { questionId, value, version };
    setValues((v) => ({ ...v, [questionId]: value }));
    setSaveStatus("Saving…");
    void persist().catch(() =>
      setError(
        "Local draft storage unavailable. Keep this page open while answers synchronize.",
      ),
    );
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void synchronize(), 700);
  }
  if (!exam)
    return (
      <main className="preflight">
        <ErrorBox message={error} />
        <Loading />
      </main>
    );
  if (attempt && attempt.status !== "ACTIVE")
    return (
      <main className="preflight">
        <span className="brand-icon">
          <CheckCircle2 />
        </span>
        <h1>Examination submitted</h1>
        {Object.keys(answers.current).length > 0 && (
          <div className="error">
            Some offline edits arrived after the server closed your attempt and
            were not accepted. A local copy remains on this device. Contact your
            instructor before clearing browser data.
          </div>
        )}
        <p>
          {attempt.status === "AUTO_SUBMITTED_SECURITY"
            ? "Your examination has been automatically submitted because the maximum permitted security-warning limit was reached."
            : attempt.status === "AUTO_SUBMITTED_TIME"
              ? "The examination time has ended. Your last synchronized answers are submitted."
              : "Your submission has been recorded. Further answer editing is locked."}
        </p>
        <p>
          Your instructor can review all incidents, including device or location
          failures.
        </p>
        <div className="panel form-panel">
          <h2>{attempt.title}</h2>
          <p>Status: {attempt.status.replaceAll("_", " ")}</p>
          <p>
            {attempt.score !== null
              ? "Released score: " + attempt.score
              : "Results are awaiting grading or release."}
          </p>
          {attempt.feedback && <p>{attempt.feedback}</p>}
        </div>
        <Link className="button primary" href="/workspace">
          Back to your workspace
        </Link>
      </main>
    );
  if (!attempt) {
    const p = exam.policy;
    const autoSubmitTriggers: string[] = [];
    if (p.tabMonitoring)
      autoSubmitTriggers.push(
        "switching away from or hiding the exam tab/window",
      );
    if (p.fullscreen && examFullscreenRequired(p.fullscreen, deviceClass))
      autoSubmitTriggers.push("exiting required fullscreen mode");
    if (p.camera)
      autoSubmitTriggers.push(
        "turning off or disconnecting the required camera",
      );
    if (p.aiCameraMonitoring && p.camera)
      autoSubmitTriggers.push(
        "Ollama detects no face clearly visible in either camera sample",
      );
    if (p.aiCameraMonitoring && p.camera)
      autoSubmitTriggers.push(
        "Ollama detects two or more faces clearly visible in a camera sample",
      );
    if (p.microphone)
      autoSubmitTriggers.push(
        "turning off or disconnecting the required microphone",
      );
    if (
      examScreenSharingRequired(p.screen, deviceClass) &&
      !screenShareUnsupported
    )
      autoSubmitTriggers.push(
        "stopping the screen share you approved in your browser",
      );
    if (p.location)
      autoSubmitTriggers.push(
        "repeated location readings clearly outside the classroom radius",
      );
    if (!p.allowPaste)
      autoSubmitTriggers.push("attempting to paste into an answer");
    const disclosedChecks = [
      ["Internet connection", "Required to load questions and save answers."],
      ["Supported device", "Only laptops and tablets can start this exam."],
      [
        "Student identity",
        "Your name, student ID and account email are attached to your attempt.",
      ],
      [
        "Camera and movement signals",
        p.camera
          ? "Camera permission is required; coarse movement signals may be logged for instructor review."
          : "Camera monitoring is not enabled.",
      ],
      ...(p.aiCameraMonitoring
        ? [
            [
              "Ollama camera review",
              "During the exam, two small, low-resolution camera samples are sent to Ollama about once every 20 seconds. If no face is clearly visible in either sample, or two or more distinct faces are clearly visible, that detection counts as a security warning and can contribute to automatic submission at the exam's warning limit. Possible mouth movement or a phone/extra screen produce advisory signals only. Samples are transient and are not stored by this app. Automated results can be mistaken and do not prove misconduct; instructors can review the signal and time.",
            ],
          ]
        : []),
      [
        "Microphone sound level",
        p.microphone
          ? "Microphone permission is required; sustained sound levels may be logged. Audio is not recorded or transcribed."
          : "Microphone monitoring is not enabled.",
      ],
      [
        "Classroom location",
        p.location
          ? "Your device location is checked against the configured classroom radius."
          : "Classroom location is not checked.",
      ],
      [
        "Entire-screen sharing",
        examScreenSharingRequired(p.screen, deviceClass)
          ? "Required on laptops. Choose Entire screen in the browser prompt; sharing a tab or window does not pass."
          : deviceClass === "tablet"
            ? "Not required on tablets; screen sharing is unavailable in tablet typing mode."
            : "Required on laptops only.",
      ],
      [
        "Fullscreen",
        p.fullscreen
          ? deviceClass === "tablet"
            ? "Tablet typing mode is used; browser fullscreen is not required."
            : "Fullscreen is required on this device."
          : "Fullscreen is not required.",
      ],
      [
        "Tab and window changes",
        p.tabMonitoring
          ? "Leaving or hiding the exam tab can create a security warning. The browser cannot block switching apps."
          : "Tab and window changes are not monitored.",
      ],
      [
        "Copy and paste",
        !p.allowCopy || !p.allowPaste
          ? `Copy is ${p.allowCopy ? "allowed" : "blocked"}; paste is ${p.allowPaste ? "allowed" : "blocked"}.`
          : "Copying and pasting are allowed.",
      ],
      [
        "Question navigation",
        p.navigation
          ? "You can move between questions."
          : "You must answer questions in order; earlier questions cannot be reopened.",
      ],
      [
        "Classroom code",
        p.classroomCode
          ? "A current classroom code is required before entry."
          : "A classroom code is not required.",
      ],
      [
        "Instructor approval",
        p.teacherApproval
          ? "Your instructor must approve your check-in before the exam starts."
          : "Instructor approval is not required.",
      ],
      [
        "Answer and event records",
        `Answers, submission times and enabled security events are retained for ${p.retentionDays} days for authorized instructor review.`,
      ],
    ];
    const maximumLocationUncertainty = Math.max(
      100,
      Number(exam.classroom?.accuracy ?? 0),
      Number(exam.classroom?.radius ?? 0),
    );
    const locationGood =
      !!point && point.accuracy <= maximumLocationUncertainty;
    const examOpen =
      ["LIVE", "PUBLISHED", "SCHEDULED"].includes(exam.status) &&
      new Date(exam.starts_at).getTime() <= clockNow &&
      new Date(exam.ends_at).getTime() > clockNow;
    const allowed =
      examOpen &&
      identitySaved &&
      identityConfirmed &&
      accepted &&
      (!p.aiCameraMonitoring || aiCameraAccepted) &&
      (deviceClass !== "tablet" || !p.camera || cameraEvidenceAccepted) &&
      online &&
      permissionReady &&
      (!p.camera || checks.camera) &&
      (!p.microphone || checks.microphone) &&
      screenSharePreflightSatisfied(
        examScreenSharingRequired(p.screen, deviceClass),
        checks.screen,
        screenSurface,
      ) &&
      (!p.location || locationGood) &&
      examFullscreenSatisfied(p.fullscreen, deviceClass, checks.fullscreen) &&
      (deviceClass === "laptop" || deviceClass === "tablet") &&
      (!p.classroomCode || code.length === 6);
    return (
      <main className="preflight">
        <Link href="/workspace" className="brand">
          <ShieldCheck /> SecureExam Pro
        </Link>
        <div className="eyebrow">A FEW CHECKS BEFORE YOU BEGIN</div>
        <h1>Exam security check</h1>
        <h2>{exam.title}</h2>
        <Markdown text={exam.instructions} />
        <section className="exam-risk-warning" role="alert">
          <div className="exam-risk-heading">
            <AlertTriangle size={22} aria-hidden="true" />
            <h2>Important: your exam may be automatically submitted</h2>
          </div>
          {p.autoTerminate ? (
            <p>
              The configured security policy allows automatic submission after{" "}
              <strong>{p.maxWarnings} security warnings</strong>. A warning can
              be issued for these enabled checks:
            </p>
          ) : (
            <p>
              Security events are recorded for instructor review. This exam is
              not configured to auto-submit based on its warning count.
            </p>
          )}
          {autoSubmitTriggers.length > 0 ? (
            <ul>
              {autoSubmitTriggers.map((trigger) => (
                <li key={trigger}>{trigger}</li>
              ))}
            </ul>
          ) : (
            <p>No security warning triggers are enabled for this exam.</p>
          )}
          <p>
            The exam timer submits your attempt when it expires. An instructor
            can also close an exam and end active attempts. A security
            auto-submission does not permanently ban your account; ask your
            instructor to review the record if you believe a warning was
            incorrect.
          </p>
          <p>
            The audit records monitored events and answer save/submission times.
            {examScreenSharingRequired(p.screen, deviceClass) &&
            screenShareUnsupported
              ? " Full-screen sharing has not passed. You cannot start until the browser confirms that Entire screen is being shared."
              : examScreenSharingRequired(p.screen, deviceClass)
                ? " This exam requires your entire screen to remain shared. A small screenshot may be saved with a monitored activity event while sharing is active. If evidence archiving is configured, warning screenshots and a timestamped activity report are stored in the instructor’s Secure Exam Google Drive folder. Authorized instructors can review them while the exam record is retained; deleting the exam also removes its stored files and archive."
                : deviceClass === "tablet" && p.screen
                  ? " Screen sharing is not used on tablets."
                  : " Screen sharing is required on laptops only."}{" "}
            Camera movement and microphone sound signals can be mistaken; they
            do not identify a person or prove misconduct. Your instructor must
            review the evidence.
          </p>
        </section>
        <section
          className="panel form-panel"
          aria-labelledby="preflight-check-list-title"
        >
          <h2 id="preflight-check-list-title">Checks used for this exam</h2>
          <p className="muted">
            Review each enabled check and the information it uses before
            continuing.
          </p>
          <ul className="preflight-check-list">
            {disclosedChecks.map(([name, detail]) => (
              <li key={name}>
                <strong>{name}</strong>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">
            When automatic submission is enabled, reaching {p.maxWarnings}{" "}
            security warnings can submit the exam. A warning is a signal for
            review, not proof of misconduct. Your instructor can review recorded
            events and should consider browser/device limitations.
          </p>
        </section>
        <section className="panel form-panel student-identity">
          <h2>Confirm your student details</h2>
          <p className="muted">
            These details are linked to your account and will appear with your
            exam attempt. Save your student ID if it is missing or incorrect.
          </p>
          <div className="form-grid">
            <label>
              Full name
              <input value={user.name} readOnly />
            </label>
            <label>
              Student ID
              <input
                value={studentId}
                onChange={(event) => {
                  const next = event.target.value;
                  setStudentId(next);
                  setIdentitySaved(next.trim() === (user.student_id ?? ""));
                  setIdentityConfirmed(false);
                }}
                autoComplete="off"
                maxLength={50}
                placeholder="Enter your university student ID"
              />
            </label>
            <label>
              Email
              <input value={user.email} readOnly />
            </label>
          </div>
          {!identitySaved && (
            <button
              type="button"
              disabled={identitySaving || !studentId.trim()}
              onClick={async () => {
                setIdentitySaving(true);
                setError("");
                try {
                  const result = await api(
                    "me/profile",
                    { studentId: studentId.trim() },
                    "PATCH",
                  );
                  setStudentId(result.studentId);
                  setIdentitySaved(true);
                  setIdentityConfirmed(false);
                } catch (cause) {
                  setError((cause as Error).message);
                } finally {
                  setIdentitySaving(false);
                }
              }}
            >
              {identitySaving ? "Saving student ID…" : "Save student ID"}
            </button>
          )}
          <label className="check consent">
            <input
              type="checkbox"
              checked={identityConfirmed}
              disabled={!identitySaved}
              onChange={(event) => setIdentityConfirmed(event.target.checked)}
            />{" "}
            I confirm my name, student ID and email are correct.
          </label>
        </section>
        <div className="notice">
          <ShieldCheck size={22} />
          <div>
            <strong>Your privacy, explained</strong>
            <p>
              This exam monitors{" "}
              {Object.entries(p)
                .filter(
                  ([k, v]) =>
                    [
                      "camera",
                      "microphone",
                      "location",
                      "fullscreen",
                      "tabMonitoring",
                    ].includes(k) &&
                    v &&
                    !(k === "fullscreen" && deviceClass === "tablet"),
                )
                .map(([k]) => k)
                .join(", ")}
              . Device events, location readings, answers and server timestamps
              are stored for authorized instructor review under a{" "}
              {p.retentionDays}-day retention policy. Raw video and microphone
              recordings are not uploaded. On tablets, a single camera still may
              be captured when a monitored activity event occurs. If Ollama
              reports that your face is not visible, a timestamped camera still
              is attached to that warning and archived in Google Drive when
              Drive storage is configured. Browser observations can be
              incomplete or inaccurate; your instructor reviews the evidence.
              Sustained microphone sound levels and coarse frame movement are
              checked in this browser. Sound levels cannot identify speech or
              conversation. No audio or transcript is sent to AI.{" "}
              {p.aiCameraMonitoring
                ? "Two reduced camera samples are periodically sent to Ollama for the optional camera review described above; samples are not stored by this app."
                : "No camera images are sent to AI."}{" "}
              {deviceClass === "tablet"
                ? "Screen sharing is not used on tablets; warning evidence may use a camera still instead of a screenshot of your tablet screen. "
                : "Entire-screen sharing is required on laptops. "}
              {examScreenSharingRequired(p.screen, deviceClass) &&
              screenShareUnsupported
                ? "This browser/device cannot currently provide verified full-screen sharing, so you cannot start this exam here."
                : examScreenSharingRequired(p.screen, deviceClass)
                  ? "Your shared entire screen may be viewed live by your instructor, and a screenshot may be stored when a monitored activity event occurs, as explained above."
                  : "Your instructor cannot view a live screen share from this tablet."}{" "}
              A browser cannot prevent switching apps; if you leave this tab,
              the exam screen is held until you acknowledge the signal.
            </p>
          </div>
        </div>
        <div className="panel form-panel">
          <div className="preflight-grid">
            {[
              [Wifi, "Network connection", online],
              [
                Camera,
                p.camera ? "Camera required" : "Camera optional",
                !p.camera || checks.camera,
              ],
              [
                Mic,
                p.microphone ? "Microphone required" : "Microphone optional",
                !p.microphone || checks.microphone,
              ],
              [
                MapPin,
                p.location ? "Location required" : "Location optional",
                !p.location || locationGood,
              ],
              ...(p.screen
                ? [
                    [
                      ShieldCheck,
                      deviceClass === "tablet"
                        ? "Screen sharing (laptops only)"
                        : "Share entire screen (required)",
                      deviceClass === "tablet" ||
                        (!screenShareUnsupported &&
                          screenSharePreflightSatisfied(
                            true,
                            checks.screen,
                            screenSurface,
                          )),
                      deviceClass === "tablet"
                        ? "Not required on tablets"
                        : screenShareUnsupported
                          ? "Required; sharing is not verified"
                          : undefined,
                    ],
                  ]
                : []),
              [
                Maximize2,
                deviceClass === "tablet"
                  ? "Tablet typing mode"
                  : "Fullscreen capability",
                examFullscreenSatisfied(
                  p.fullscreen,
                  deviceClass,
                  checks.fullscreen,
                ),
              ],
              [
                ShieldCheck,
                deviceClass === "phone"
                  ? "Phone not allowed"
                  : "Laptop or tablet",
                deviceClass === "laptop" || deviceClass === "tablet",
              ],
            ].map(([Icon, label, ok, status]: any) => (
              <div key={label}>
                <Icon size={20} />
                <span>{label}</span>
                <span
                  className={status ? "muted" : ok ? "check-pass" : "muted"}
                >
                  {status ?? (ok ? "✓ Ready" : "Pending")}
                </span>
              </div>
            ))}
          </div>
          {examScreenSharingRequired(p.screen, deviceClass) &&
            screenShareUnsupported && (
              <p className="small error" role="alert">
                Full-screen sharing is required. On the sharing prompt, select
                <strong> Entire screen</strong>; tabs and individual windows do
                not qualify. If that option is unavailable or the browser cannot
                verify it, this device/browser cannot start the exam. Contact
                your instructor before the exam if your device cannot share its
                full screen.
              </p>
            )}
          {deviceClass !== "laptop" && deviceClass !== "tablet" && (
            <p className="error" role="alert">
              {deviceClass === "phone"
                ? "Phones are not allowed for this exam. Please use a laptop, iPad, or Android tablet."
                : "We could not verify this device. Please use a laptop, iPad, or Android tablet."}
            </p>
          )}
          {point && (
            <p className={locationGood ? "small muted" : "small error"}>
              Location accuracy: ±{Math.round(point.accuracy)} m.
              {locationGood
                ? " Classroom eligibility is verified by the server at entry."
                : ` Improve the GPS reading or ask your instructor to check the classroom location settings (allowed uncertainty: ${Math.round(maximumLocationUncertainty)} m).`}
            </p>
          )}
          {deviceClass === "tablet" && p.fullscreen && (
            <p className="small muted">
              Tablet mode keeps the exam page available when the on-screen
              keyboard opens. Tab-change and other enabled security checks
              remain active.
            </p>
          )}
          <button
            onClick={permissions}
            disabled={
              busy || (deviceClass !== "laptop" && deviceClass !== "tablet")
            }
          >
            {busy
              ? "Checking permissions…"
              : "Check camera, microphone & location"}
          </button>
          {permissionReady && p.camera && (
            <video
              className="camera-preview"
              ref={video}
              autoPlay
              muted
              playsInline
            />
          )}
          {p.classroomCode && (
            <label>
              Rotating classroom code
              <input
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                maxLength={6}
                placeholder="6-digit code from your instructor"
              />
            </label>
          )}
          {p.teacherApproval && (
            <button
              onClick={async () => {
                try {
                  await api(`exams/${examId}/checkin`, {});
                  setError(
                    "Waiting for teacher approval. Begin once your instructor approves your entry.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Request teacher approval
            </button>
          )}
          <label className="check consent">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />{" "}
            I have read the monitoring notice and examination instructions.
          </label>
          {deviceClass === "tablet" && p.camera && (
            <label className="check consent">
              <input
                type="checkbox"
                checked={cameraEvidenceAccepted}
                onChange={(event) =>
                  setCameraEvidenceAccepted(event.target.checked)
                }
              />{" "}
              I understand that when a monitored activity event occurs, a still
              image from my camera may be captured and stored as warning
              evidence for instructor review. It is not a recording of my tablet
              screen.
            </label>
          )}
          {p.aiCameraMonitoring && (
            <label className="check consent">
              <input
                type="checkbox"
                checked={aiCameraAccepted}
                onChange={(event) => setAiCameraAccepted(event.target.checked)}
              />{" "}
              I understand and agree that two reduced camera samples are sent to
              Ollama about once every 20 seconds. If no face is clearly visible
              in either sample, or two or more distinct faces are clearly
              visible, that detection counts as a security warning and may
              contribute to automatic submission at the exam warning limit.
              Other camera signals are advisory only. Samples are not stored by
              this app, and automated detections can be mistaken.
            </label>
          )}
          {!examOpen && (
            <div className="notice" role="status">
              <Clock3 size={19} />
              {clockNow < new Date(exam.starts_at).getTime()
                ? `This exam opens at ${time(exam.starts_at)}. You can complete the checks now; starting unlocks when the exam opens.`
                : exam.status === "PAUSED"
                  ? "This exam is paused by your instructor. You can start after it is reopened."
                  : "This exam is closed. Review your submission from your workspace."}
            </div>
          )}
          <ErrorBox message={error} />
          <button
            className="primary large"
            onClick={begin}
            disabled={!allowed || busy}
          >
            Begin secure exam <ChevronRight size={18} />
          </button>
          {existing && (
            <button
              onClick={async () => {
                try {
                  await api(`attempts/${existing.attempt_id}/recover`, {
                    deviceSessionId: device.current,
                  });
                  setError(
                    "Re-entry approved. Complete the checks and begin to resume.",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Recover after teacher allows re-entry
            </button>
          )}
        </div>
      </main>
    );
  }
  const questions = attempt.question_order
    .map((id: string) => attempt.questions.find((q: any) => q.id === id))
    .filter(Boolean);
  const wordPaper = attempt.files?.find(
    (file: any) =>
      file.mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  const q = questions[index];
  const answered = Object.values(values).filter(
    (v) => v !== null && v !== "" && (!Array.isArray(v) || v.length),
  ).length;
  const blocked =
    attempt.examStatus === "PAUSED" ||
    (attempt.policy.fullscreen && !fullscreen) ||
    tabHold;
  return (
    <div className="exam-shell">
      <header className="exam-top">
        <div>
          <ShieldCheck size={24} />
          <span>
            <strong>{attempt.title}</strong>
            <small>
              {user.name} · {user.student_id}
            </small>
          </span>
        </div>
        <div className="exam-clock">
          <Clock3 size={20} />
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:
          {String(seconds % 60).padStart(2, "0")}
        </div>
        <span className={online ? "save-indicator" : "danger-text"}>
          {online ? "● Connected" : "● Offline"}
        </span>
        <button
          className="primary"
          onClick={async () => {
            if (wordPaper && !attempt.documentSubmission) {
              setError(
                "Upload your completed Word question paper before submitting the exam.",
              );
              return;
            }
            if (
              confirm(
                `Answered: ${answered}\nUnanswered: ${questions.length - answered}\n${wordPaper ? `Word paper: ${attempt.documentSubmission ? "uploaded" : "not uploaded"}\n` : ""}Flagged for review: ${flagged.length}\n\nSubmit your examination? This locks editing.`,
              )
            ) {
              await synchronize(true);
            }
          }}
        >
          <Send size={16} /> Submit exam
        </button>
      </header>
      <div className="exam-status">
        <span>{saveStatus}</span>
        <span>
          Warnings {attempt.warnings} / {attempt.policy.maxWarnings}
        </span>
        <span>{attempt.location_status.replaceAll("_", " ")}</span>
      </div>
      {warning && (
        <div className="warning-banner" role="alert">
          <AlertTriangle />
          <div>
            <strong>{warning}</strong>
            <p>
              Monitoring signals can have innocent causes. Review this notice
              and restore the required examination conditions.
            </p>
          </div>
          <button
            onClick={() => {
              setWarning("");
              setTabHold(false);
            }}
          >
            Acknowledge
          </button>
        </div>
      )}
      <ErrorBox message={error} />
      {attempt.notifications?.map((n: any) => (
        <div className="notice" key={n.id}>
          Instructor: {n.message}
        </div>
      ))}
      <div className="exam-body">
        <aside className="question-nav">
          <div className="eyebrow">YOUR PROGRESS</div>
          <h3>
            {questions.length
              ? `${answered} of ${questions.length} answered`
              : wordPaper
                ? attempt.documentSubmission
                  ? "Word paper uploaded"
                  : "Word paper to complete"
                : "No questions assigned"}
          </h3>
          {questions.length > 0 && (
            <div className="progress">
              <span
                style={{ width: (answered / questions.length) * 100 + "%" }}
              />
            </div>
          )}
          <div className="question-numbers">
            {questions.map((q: any, i: number) => (
              <button
                key={q.id}
                disabled={!attempt.policy.navigation && i !== index}
                onClick={() => setIndex(i)}
                className={
                  (i === index ? "current " : "") +
                  (values[q.id] !== undefined && values[q.id] !== ""
                    ? "answered "
                    : "") +
                  (flagged.includes(q.id) ? "flagged" : "")
                }
                aria-label={"Question " + (i + 1)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p className="small muted">
            Filled = answered
            <br />
            Outline = current
            <br />• = flagged for review
          </p>
          {attempt.policy.camera && (
            <video
              ref={video}
              className="camera-preview"
              autoPlay
              muted
              playsInline
            />
          )}
          <div className="device-labels">
            <span>
              Camera{" "}
              {stream.current?.getVideoTracks().some(captureTrackIsActive)
                ? "active"
                : "off"}
            </span>
            <span>
              Microphone{" "}
              {stream.current?.getAudioTracks().some(captureTrackIsActive)
                ? "active"
                : "off"}
            </span>
            {attempt.policy?.screen && (
              <span>
                Screen{" "}
                {screenStream.current
                  ?.getVideoTracks()
                  .some(captureTrackIsActive)
                  ? "shared for live instructor review"
                  : "share unavailable"}
              </span>
            )}
          </div>
        </aside>
        <main className="question-area">
          {blocked ? (
            <div className="empty">
              <Maximize2 size={32} />
              <h2>
                {attempt.examStatus === "PAUSED"
                  ? "Your instructor has paused this examination."
                  : tabHold
                    ? "You left the examination tab. Acknowledge the monitoring signal above to continue."
                    : "Return to fullscreen to continue."}
              </h2>
              {attempt.examStatus !== "PAUSED" && !tabHold && (
                <button
                  className="primary"
                  onClick={() => document.documentElement.requestFullscreen()}
                >
                  Return to fullscreen
                </button>
              )}
            </div>
          ) : questions.length === 0 ? (
            <section className="panel form-panel">
              <h2>Complete the question paper in Word</h2>
              <p>
                Download the instructor’s DOCX, fill in your answers, then
                upload your completed copy below. Your submission is private to
                this attempt and named with your student name and ID.
              </p>
            </section>
          ) : (
            q && (
              <>
                <div className="question-meta">
                  <span className="eyebrow">
                    QUESTION {index + 1} OF {questions.length}
                  </span>
                  <span>{q.marks} marks</span>
                  <button
                    className={
                      flagged.includes(q.id)
                        ? "flag-button marked"
                        : "flag-button"
                    }
                    onClick={() =>
                      setFlagged((f) =>
                        f.includes(q.id)
                          ? f.filter((id) => id !== q.id)
                          : [...f, q.id],
                      )
                    }
                  >
                    <Flag size={15} /> Flag for review
                  </button>
                </div>
                <Markdown text={q.prompt} />
                <div className="answer-input">
                  {["MCQ", "TRUE_FALSE", "MULTI_SELECT"].includes(q.type) ? (
                    q.options.map((option: string) => (
                      <label className="answer-option" key={option}>
                        <input
                          type={
                            q.type === "MULTI_SELECT" ? "checkbox" : "radio"
                          }
                          name={q.id}
                          checked={
                            q.type === "MULTI_SELECT"
                              ? (values[q.id] ?? []).includes(option)
                              : values[q.id] === option
                          }
                          onChange={(e) =>
                            change(
                              q.id,
                              q.type === "MULTI_SELECT"
                                ? e.target.checked
                                  ? [...(values[q.id] ?? []), option]
                                  : (values[q.id] ?? []).filter(
                                      (v: string) => v !== option,
                                    )
                                : option,
                            )
                          }
                        />
                        <span>{option}</span>
                      </label>
                    ))
                  ) : q.type === "CODING" ? (
                    <>
                      <p className="small muted">
                        Code is stored for manual grading. It is never executed
                        on the application server.
                      </p>
                      <Editor
                        height="380px"
                        language="python"
                        value={values[q.id] ?? ""}
                        onChange={(v) => change(q.id, v ?? "")}
                        options={{
                          minimap: { enabled: false },
                          fontSize: 15,
                          automaticLayout: true,
                          wordWrap: "on",
                        }}
                      />
                    </>
                  ) : q.type === "FILE_UPLOAD" ? (
                    <>
                      <Upload
                        examId={examId}
                        attemptId={attempt.id}
                        device={device.current}
                        done={(id) => change(q.id, id)}
                      />
                      {values[q.id] && (
                        <p>
                          <a
                            href={`/api/platform/files/${values[q.id]}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open your uploaded answer
                          </a>
                        </p>
                      )}
                    </>
                  ) : ["NUMERIC", "FILL_BLANK"].includes(q.type) ? (
                    <label>
                      Your answer
                      <input
                        className="exam-answer-field"
                        type={q.type === "NUMERIC" ? "number" : "text"}
                        step="any"
                        value={values[q.id] ?? ""}
                        onChange={(e) => change(q.id, e.target.value)}
                      />
                    </label>
                  ) : (
                    <label>
                      {q.type === "MATCHING"
                        ? "Enter your matching pairs, one per line"
                        : q.type === "SHORT_ANSWER"
                          ? "Your answer"
                          : "Your response"}
                      <textarea
                        className="exam-answer-field"
                        rows={q.type === "SHORT_ANSWER" ? 4 : 12}
                        value={values[q.id] ?? ""}
                        onChange={(e) => change(q.id, e.target.value)}
                        placeholder="Write your answer here…"
                      />
                    </label>
                  )}
                </div>
                <div className="question-footer">
                  <button
                    disabled={index === 0 || !attempt.policy.navigation}
                    onClick={() => setIndex(index - 1)}
                  >
                    <ChevronLeft size={16} /> Previous
                  </button>
                  <button
                    disabled={index === questions.length - 1}
                    onClick={() => setIndex(index + 1)}
                  >
                    Next question <ChevronRight size={16} />
                  </button>
                </div>
              </>
            )
          )}
          {wordPaper && (
            <section className="panel form-panel document-paper">
              <h2>Word question paper</h2>
              <p>{wordPaper.name}</p>
              <a
                className="button primary"
                href={"/api/platform/files/" + wordPaper.id + "?download=1"}
              >
                Download editable Word paper
              </a>
              <h3>Your completed paper</h3>
              {attempt.documentSubmission ? (
                <p>
                  <a
                    href={
                      "/api/platform/files/" +
                      attempt.documentSubmission.id +
                      "?download=1"
                    }
                  >
                    {attempt.documentSubmission.name}
                  </a>
                  <span className="small muted">
                    {" "}
                    · You can upload a revised copy before submitting.
                  </span>
                </p>
              ) : (
                <p className="muted">No completed paper uploaded yet.</p>
              )}
              {attempt.status === "ACTIVE" && (
                <Upload
                  examId={examId}
                  attemptId={attempt.id}
                  device={device.current}
                  documentSubmission
                  done={(id, name) =>
                    setAttempt((current: any) => ({
                      ...current,
                      documentSubmission: { id, name },
                    }))
                  }
                />
              )}
            </section>
          )}
          <div className="watermark">
            {user.student_id} · {user.name} ·{" "}
            {new Date(attempt.serverTime).toISOString()}
          </div>
          {attempt.files?.length > 0 && (
            <section>
              <h3>Exam materials</h3>
              {attempt.files.map((f: any) => (
                <details key={f.id}>
                  <summary>{f.name}</summary>
                  {f.mime === "application/pdf" ? (
                    <iframe
                      title={f.name}
                      src={"/api/platform/files/" + f.id + "#toolbar=0"}
                      width="100%"
                      height="600"
                    />
                  ) : f.mime.startsWith("image/") ? (
                    <img alt={f.name} src={"/api/platform/files/" + f.id} />
                  ) : (
                    <pre>
                      {f.extracted_text || "This document has no text preview."}
                    </pre>
                  )}
                  {(attempt.policy.allowDownload || f.id === wordPaper?.id) && (
                    <a href={"/api/platform/files/" + f.id + "?download=1"}>
                      {f.mime ===
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        ? "Download editable Word copy"
                        : "Download material"}
                    </a>
                  )}
                  {!attempt.policy.allowDownload &&
                    f.id !== wordPaper?.id &&
                    f.mime ===
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && (
                      <p className="small muted">
                        Downloads are disabled by the instructor. Ask them to
                        enable “allowDownload” in the exam policy if you need to
                        edit and submit a Word copy.
                      </p>
                    )}
                </details>
              ))}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
