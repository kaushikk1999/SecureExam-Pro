"use client";
import { useState, useEffect, useRef } from "react";
import { signIn, signOut, getProviders } from "next-auth/react";
import {
  ShieldCheck,
  ArrowRight,
  LockKeyhole,
  GraduationCap,
  ClipboardList,
  Eye,
  MonitorCheck,
  KeyRound,
  School,
  CircleCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { matchesLoginAudience, safeStudentReturnPath } from "@/lib/auth-role";
import styles from "./login-page.module.css";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState<"student" | "teacher">("student");
  const storyRef = useRef<HTMLElement>(null);
  const rippleCanvasRef = useRef<HTMLCanvasElement>(null);

  const [google, setGoogle] = useState(false);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  useEffect(() => {
    void getProviders()
      .then((p) => {
        setGoogle(Boolean(p?.google));
        setProvidersLoaded(true);
      })
      .catch(() => setProvidersLoaded(true));
    const params = new URLSearchParams(window.location.search);
    const requestedRole = params.get("role");
    const returnTo =
      requestedRole === "student"
        ? (safeStudentReturnPath(params.get("next")) ?? "/workspace")
        : "/workspace";
    if (requestedRole === "student" || requestedRole === "teacher") {
      setAudience(requestedRole);
      void fetch("/api/auth/session", { cache: "no-store" })
        .then((response) => response.json())
        .then(async (session) => {
          const role = session?.user?.role;
          if (!role) return;
          const allowed = matchesLoginAudience(role, requestedRole);
          if (allowed) router.replace(returnTo);
          else {
            await signOut({ redirect: false });
            setError(
              requestedRole === "teacher"
                ? "This account is not set up for teacher access. Choose Student sign in or contact your administrator."
                : "This account is set up for teacher access. Choose Teacher sign in instead.",
            );
          }
        })
        .catch(() => {});
    }
    const authError = params.get("error");
    if (authError)
      setError(
        authError === "AccessDenied"
          ? "Use a verified Bangkok University student Google account ending in @bumail.net, or an approved test account. If access still fails, confirm you selected the university account and contact your instructor."
          : "Sign-in could not be completed. Check your account access or contact your administrator.",
      );
  }, [router]);
  const [brand, setBrand] = useState({
    brand: "SecureExam Pro",
    institution: "Bangkok University",
  });
  useEffect(() => {
    fetch("/api/branding")
      .then((r) => r.json())
      .then(setBrand)
      .catch(() => {});
  }, []);
  useEffect(() => {
    const story = storyRef.current;
    const canvas = rippleCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!story || !canvas || !context) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) return;

    type Ripple = { x: number; y: number; startedAt: number };
    const ripples: Ripple[] = [];
    let animationFrame = 0;
    let lastRippleAt = 0;
    let running = false;

    const resizeCanvas = () => {
      const bounds = story.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(bounds.width * pixelRatio);
      canvas.height = Math.round(bounds.height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const render = (now: number) => {
      const bounds = story.getBoundingClientRect();
      context.clearRect(0, 0, bounds.width, bounds.height);
      const activeRipples: Ripple[] = [];

      for (const ripple of ripples) {
        const progress = (now - ripple.startedAt) / 1550;
        if (progress >= 1) continue;
        activeRipples.push(ripple);
        const fade = (1 - progress) ** 1.4;

        for (let ring = 0; ring < 3; ring += 1) {
          const phase = progress - ring * 0.13;
          if (phase <= 0) continue;
          const radius = 220 * phase;
          context.beginPath();
          context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
          context.strokeStyle = `rgba(0, 219, 233, ${fade * (0.68 - ring * 0.12)})`;
          context.lineWidth = Math.max(1, 4.2 * (1 - phase));
          context.shadowColor = "rgba(0, 219, 233, 0.9)";
          context.shadowBlur = 34 * fade;
          context.stroke();
        }
      }

      ripples.splice(0, ripples.length, ...activeRipples);
      context.shadowBlur = 0;
      if (ripples.length > 0) {
        animationFrame = window.requestAnimationFrame(render);
      } else {
        running = false;
        context.clearRect(0, 0, bounds.width, bounds.height);
      }
    };

    const startAnimation = () => {
      if (running) return;
      running = true;
      animationFrame = window.requestAnimationFrame(render);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const now = performance.now();
      if (now - lastRippleAt < 95) return;
      const bounds = story.getBoundingClientRect();
      ripples.push({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        startedAt: now,
      });
      if (ripples.length > 12) ripples.shift();
      lastRippleAt = now;
      startAnimation();
    };

    resizeCanvas();
    const resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(story);
    story.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      story.removeEventListener("pointermove", onPointerMove);
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);
  function authCallbackUrl(role: "student" | "teacher") {
    const next =
      role === "student"
        ? safeStudentReturnPath(
            new URLSearchParams(window.location.search).get("next"),
          )
        : null;
    return `/login?role=${role}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  }
  return (
    <main className={styles.page}>
      <section
        ref={storyRef}
        className={styles.story}
        aria-label="SecureExam Pro"
      >
        <div className={styles.ambientGrid} aria-hidden="true" />
        <div className={styles.glowOne} aria-hidden="true" />
        <div className={styles.glowTwo} aria-hidden="true" />
        <canvas
          ref={rippleCanvasRef}
          className={styles.rippleCanvas}
          aria-hidden="true"
        />
        <div className={styles.storyTop}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandIcon}>
              <ShieldCheck size={22} />
            </span>
            <span>
              {brand.brand.split(" ").slice(0, -1).join(" ")}{" "}
              <b>{brand.brand.split(" ").at(-1)}</b>
            </span>
          </Link>
          <div className={styles.institution}>
            <School size={15} />
            <span>{brand.institution} · Evaluation node</span>
            <i aria-hidden="true" />
          </div>
          <div className={styles.hero}>
            <p className={styles.kicker}>A focused space for fair assessment</p>
            <h1>
              A clear mind.
              <br />
              <span>A fair start.</span>
            </h1>
            <p className={styles.heroDescription}>
              Your teaching. Your students. One trusted institutional examination workspace.
            </p>
          </div>
        </div>
        <div className={styles.featureDeck}>
          <div className={styles.integrityCard}>
            <span className={styles.integrityIcon}>
              <LockKeyhole size={17} />
            </span>
            <div>
              <small>ASSESSMENT APPROACH</small>
              <strong>Instructor-led review</strong>
              <span>Monitoring signals are visible and reviewed with context.</span>
            </div>
            <CircleCheck className={styles.integrityCheck} size={20} />
          </div>
          <div className={styles.features}>
            <article>
              <span>
                <Eye size={17} />
              </span>
              <div>
                <strong>Contextual signals</strong>
                <p>Signals support instructor review.</p>
              </div>
            </article>
            <article>
              <span>
                <MonitorCheck size={17} />
              </span>
              <div>
                <strong>Course-linked exams</strong>
                <p>Keep courses and assessments together.</p>
              </div>
            </article>
            <article>
              <span>
                <KeyRound size={17} />
              </span>
              <div>
                <strong>University sign-in</strong>
                <p>Use the account assigned to you.</p>
              </div>
            </article>
          </div>
        </div>
        <footer className={styles.storyFooter}>
          <span>Privacy-conscious monitoring · Instructor-led decisions</span>
          <span>SECURE ASSESSMENT WORKSPACE</span>
        </footer>
      </section>

      <section className={styles.auth} aria-labelledby="auth-title">
        <div className={styles.authContent}>
          <div className={styles.authHeader}>
            <span className={styles.authIcon}>
              <LockKeyhole size={23} />
            </span>
            <span className={styles.authKicker}>SECURE UNIVERSITY ACCESS</span>
            <h2 id="auth-title">
              {audience === "student" ? "Student sign in" : "Teacher sign in"}
            </h2>
            <p>
              {audience === "student"
                ? "Access your exams, practice, and learning progress."
                : "Access your courses, exams, reports, and instructor tools."}
            </p>
          </div>

          <div
            className={styles.rolePicker}
            role="group"
            aria-label="Choose sign-in type"
          >
            <button
              type="button"
              className={audience === "student" ? styles.roleSelected : ""}
              aria-pressed={audience === "student"}
              onClick={() => {
                setAudience("student");
                setError("");
              }}
            >
              <span className={styles.roleTitle}>
                <GraduationCap size={18} />
                <strong>Student</strong>
              </span>
              <span>Take exams and view results</span>
            </button>
            <button
              type="button"
              className={audience === "teacher" ? styles.roleSelected : ""}
              aria-pressed={audience === "teacher"}
              onClick={() => {
                setAudience("teacher");
                setError("");
              }}
            >
              <span className={styles.roleTitle}>
                <ClipboardList size={18} />
                <strong>Teacher</strong>
              </span>
              <span>Manage classes and exams</span>
            </button>
          </div>

          <div className={styles.providers}>
            <button
              className={styles.googleButton}
              disabled={!google || busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await signIn(
                    "google",
                    { callbackUrl: authCallbackUrl(audience) },
                    { prompt: "select_account" },
                  );
                } catch {
                  setError("Google sign-in could not start. Please retry.");
                  setBusy(false);
                }
              }}
            >
              <span className={styles.googleMark} aria-hidden="true">
                G
              </span>
              <span>{busy ? "Opening Google…" : "Continue with Google"}</span>
              <ArrowRight size={16} />
            </button>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            {providersLoaded && !google && (
              <p className={styles.providerNotice} role="status">
                Google sign-in is not configured in this environment.
              </p>
            )}
          </div>

          <p className={styles.guidance}>
            {audience === "student"
              ? "Continue with your assigned university Google account."
              : "Teacher access uses your university Google account."}
          </p>
          <Link className={styles.backLink} href="/">
            ← Back to SecureExam
          </Link>
        </div>
        <footer className={styles.authFooter}>
          <span>
            <i aria-hidden="true" /> Account sign-in
          </span>
          <span>Secure connection</span>
        </footer>
      </section>
    </main>
  );
}
