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
import { classifyExamDevice, type ExamDeviceClass } from "@/lib/exam-device";
import { api, Markdown, ErrorBox, Loading, time } from "./ui";
import { Upload } from "./workspace";
const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
loader.config({ paths: { vs: "/monaco/vs" } });
type QueuedAnswer = { questionId: string; value: any; version: number };
type QueuedEvent = { id: string; type: string; metadata: Record<string, any> };
export default function ExamRoom({
  examId,
  enrollmentToken,
  user,
}: {
  examId: string;
  enrollmentToken: string | null;
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
    [code, setCode] = useState(""),
    [point, setPoint] = useState<any>(null),
    [permissionReady, setPermissionReady] = useState(false),
    [index, setIndex] = useState(0),
    [values, setValues] = useState<Record<string, any>>({}),
    [flagged, setFlagged] = useState<string[]>([]),
    [saveStatus, setSaveStatus] = useState("All answers saved"),
    [online, setOnline] = useState(true),
    [warning, setWarning] = useState(""),
    [seconds, setSeconds] = useState(0),
    [clockNow, setClockNow] = useState(0),
    [fullscreen, setFullscreen] = useState(true);
  const device = useRef(""),
    stream = useRef<MediaStream | null>(null),
    screenStream = useRef<MediaStream | null>(null),
    video = useRef<HTMLVideoElement | null>(null),
    active = useRef<any>(null),
    answers = useRef<Record<string, QueuedAnswer>>({}),
    events = useRef<QueuedEvent[]>([]),
    versions = useRef<Record<string, number>>({}),
    lastEvent = useRef(-Infinity),
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
              fullscreen: !!document.fullscreenElement,
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
    [alert, key, persist],
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
        if (now - lastEvent.current < 10000) return;
        lastEvent.current = now;
      }
      events.current.push({ id: crypto.randomUUID(), type, metadata });
      void persist();
      void synchronize();
    },
    [persist, synchronize],
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
    setDeviceClass(
      classifyExamDevice({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        minScreenDimension: Math.min(screen.width, screen.height),
        mobileHint: browserNavigator.userAgentData?.mobile,
      }),
    );
    setChecks((c) => ({
      ...c,
      fullscreen: document.fullscreenEnabled,
    }));
    async function loadExam() {
      if (enrollmentToken)
        await api(`exams/${examId}/self-enroll`, { token: enrollmentToken });
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
    };
  }, [examId, enrollmentToken]);
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
    try {
      const p = exam.policy;
      stream.current?.getTracks().forEach((t) => t.stop());
      if (p.camera || p.microphone) {
        stream.current = await navigator.mediaDevices.getUserMedia({
          video: p.camera,
          audio: p.microphone,
        });
        for (const track of stream.current.getTracks()) {
          track.onended = () =>
            emit(
              track.kind === "video"
                ? "CAMERA_DISABLED"
                : "MICROPHONE_DISABLED",
            );
          track.onmute = () => {
            setTimeout(() => {
              if (track.muted)
                emit(
                  track.kind === "video"
                    ? "CAMERA_DISABLED"
                    : "MICROPHONE_DISABLED",
                );
            }, 10000);
          };
        }
      }
      if (p.screen) {
        screenStream.current = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        screenStream.current
          .getVideoTracks()
          .forEach((t) => (t.onended = () => emit("SCREEN_SHARE_STOPPED")));
      }
      if (p.location) {
        const reading = await new Promise<GeolocationPosition>(
          (resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 20000,
              maximumAge: 0,
            }),
        );
        const loc = {
          latitude: reading.coords.latitude,
          longitude: reading.coords.longitude,
          accuracy: reading.coords.accuracy,
        };
        location.current = loc;
        setPoint(loc);
      }
      setChecks((c) => ({
        ...c,
        camera: !!stream.current?.getVideoTracks().length,
        microphone: !!stream.current?.getAudioTracks().length,
        screen: !!screenStream.current?.getVideoTracks().length,
      }));
      setPermissionReady(true);
    } catch (e) {
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
      if (exam.policy.fullscreen)
        await document.documentElement.requestFullscreen();
      const result = await api(`exams/${examId}/start`, {
        deviceSessionId: device.current,
        deviceClass,
        accepted,
        checks: { ...checks, fullscreen: !!document.fullscreenElement },
        code,
        location: point,
      });
      await loadAttempt(result.id);
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
        }
      } catch {
        /* Sync reports connection errors and retains local drafts. */
      }
    }, 5000);
    const visibility = () => {
      if (document.hidden) emit("TAB_HIDDEN");
    };
    const blur = () => {
      if (document.activeElement?.tagName !== "IFRAME") emit("WINDOW_BLUR");
    };
    const full = () => {
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
    document.addEventListener("fullscreenchange", full);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    window.addEventListener("beforeunload", leave);
    document.addEventListener("paste", paste);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", copy);
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
      if (locationTimer) clearInterval(locationTimer);
      if (checkpoint) clearInterval(checkpoint);
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
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
    attempt?.policy.location,
    alert,
    emit,
    key,
    synchronize,
  ]);
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
    const examOpen =
      ["LIVE", "PUBLISHED", "SCHEDULED"].includes(exam.status) &&
      new Date(exam.starts_at).getTime() <= clockNow &&
      new Date(exam.ends_at).getTime() > clockNow;
    const allowed =
      examOpen &&
      accepted &&
      online &&
      permissionReady &&
      (!p.camera || checks.camera) &&
      (!p.microphone || checks.microphone) &&
      (!p.screen || checks.screen) &&
      (!p.location || !!point) &&
      (!p.fullscreen || checks.fullscreen) &&
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
                    ].includes(k) && v,
                )
                .map(([k]) => k)
                .join(", ")}
              . Device events, location readings, answers and server timestamps
              are stored for authorized instructor review under a{" "}
              {p.retentionDays}-day retention policy. Raw camera and microphone
              recordings are not uploaded. Browser observations can be
              incomplete or inaccurate; your instructor reviews the evidence.
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
                !p.location || !!point,
              ],
              [
                Maximize2,
                "Fullscreen capability",
                !p.fullscreen || checks.fullscreen,
              ],
              [
                ShieldCheck,
                deviceClass === "phone"
                  ? "Phone not allowed"
                  : "Laptop or tablet",
                deviceClass === "laptop" || deviceClass === "tablet",
              ],
            ].map(([Icon, label, ok]: any) => (
              <div key={label}>
                <Icon size={20} />
                <span>{label}</span>
                <span className={ok ? "check-pass" : "muted"}>
                  {ok ? "✓ Ready" : "Pending"}
                </span>
              </div>
            ))}
          </div>
          {deviceClass !== "laptop" && deviceClass !== "tablet" && (
            <p className="error" role="alert">
              {deviceClass === "phone"
                ? "Phones are not allowed for this exam. Please use a laptop, iPad, or Android tablet."
                : "We could not verify this device. Please use a laptop, iPad, or Android tablet."}
            </p>
          )}
          {point && (
            <p className="small muted">
              Location accuracy: ±{Math.round(point.accuracy)} m. Classroom
              eligibility is verified by the server at entry.
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
  const q = questions[index];
  const answered = Object.values(values).filter(
    (v) => v !== null && v !== "" && (!Array.isArray(v) || v.length),
  ).length;
  const blocked =
    attempt.examStatus === "PAUSED" ||
    (attempt.policy.fullscreen && !fullscreen);
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
            if (
              confirm(
                `Answered: ${answered}\nUnanswered: ${questions.length - answered}\nFlagged for review: ${flagged.length}\n\nSubmit your examination? This locks editing.`,
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
            <p>Check fullscreen, device permissions, and classroom location.</p>
          </div>
          <button onClick={() => setWarning("")}>Acknowledge</button>
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
            {answered} of {questions.length} answered
          </h3>
          <div className="progress">
            <span
              style={{ width: (answered / questions.length) * 100 + "%" }}
            />
          </div>
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
              {stream.current
                ?.getVideoTracks()
                .some((t) => t.readyState === "live")
                ? "active"
                : "off"}
            </span>
            <span>
              Microphone{" "}
              {stream.current
                ?.getAudioTracks()
                .some((t) => t.readyState === "live")
                ? "active"
                : "off"}
            </span>
          </div>
        </aside>
        <main className="question-area">
          {blocked ? (
            <div className="empty">
              <Maximize2 size={32} />
              <h2>
                {attempt.examStatus === "PAUSED"
                  ? "Your instructor has paused this examination."
                  : "Return to fullscreen to continue."}
              </h2>
              {attempt.examStatus !== "PAUSED" && (
                <button
                  className="primary"
                  onClick={() => document.documentElement.requestFullscreen()}
                >
                  Return to fullscreen
                </button>
              )}
            </div>
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
                  ) : ["NUMERIC", "FILL_BLANK", "SHORT_ANSWER"].includes(
                      q.type,
                    ) ? (
                    <label>
                      Your answer
                      <input
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
                        : "Your response"}
                      <textarea
                        rows={12}
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
                  {attempt.policy.allowDownload && (
                    <a href={"/api/platform/files/" + f.id} download>
                      {f.mime ===
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        ? "Download editable Word copy"
                        : "Download material"}
                    </a>
                  )}
                  {!attempt.policy.allowDownload &&
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
