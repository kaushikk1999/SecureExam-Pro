"use client";
import { useState, useEffect } from "react";
import { signIn, signOut, getProviders } from "next-auth/react";
import {
  ShieldCheck,
  ArrowRight,
  LockKeyhole,
  GraduationCap,
  ClipboardList,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  isGoogleOnlyStudentEmail,
  matchesLoginAudience,
  safeStudentReturnPath,
} from "@/lib/auth-role";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState<"student" | "teacher">("student");
  const [loginEmail, setLoginEmail] = useState("");

  const [sso, setSso] = useState(false);
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    void getProviders()
      .then((p) => {
        setSso(Boolean(p?.university));
        setGoogle(Boolean(p?.google));
      })
      .catch(() => {});
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
  async function completeSignIn(role: "student" | "teacher") {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const session = await response.json();
    const actualRole = session?.user?.role;
    if (!actualRole) {
      setError("Sign-in completed, but we could not verify your account role.");
      return;
    }
    const allowed = matchesLoginAudience(actualRole, role);
    if (!allowed) {
      await signOut({ redirect: false });
      setError(
        role === "teacher"
          ? "This account is not set up for teacher access. Choose Student sign in or contact your administrator."
          : "This account is set up for teacher access. Choose Teacher sign in instead.",
      );
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const returnTo =
      role === "student"
        ? (safeStudentReturnPath(params.get("next")) ?? "/workspace")
        : "/workspace";
    router.replace(returnTo);
  }
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
    <main className="login-page">
      <section className="login-story">
        <Link href="/" className="brand">
          <ShieldCheck /> {brand.brand}
        </Link>
        <div>
          <span className="eyebrow">{brand.institution}</span>
          <h1>
            A clear mind.
            <br />A fair start.
          </h1>
          <p>
            Your teaching. Your students.
            <br />
            One trusted examination workspace.
          </p>
        </div>
        <p className="small">
          Privacy-conscious monitoring · Instructor-led decisions
        </p>
      </section>
      <section className="login-form">
        <div>
          <div className="login-card-heading">
            <span className="brand-icon">
              <LockKeyhole />
            </span>
            <span className="login-kicker">SECURE UNIVERSITY ACCESS</span>
            <h2>
              {audience === "student" ? "Student sign in" : "Teacher sign in"}
            </h2>
          </div>
          <p className="muted">
            {audience === "student"
              ? "Access your exams, practice, and learning progress."
              : "Access your courses, exams, reports, and instructor tools."}
          </p>
          <div
            className="login-role-picker"
            role="group"
            aria-label="Choose sign-in type"
          >
            <button
              type="button"
              className={audience === "student" ? "selected" : ""}
              aria-pressed={audience === "student"}
              onClick={() => {
                setAudience("student");
                setError("");
              }}
            >
              <span className="login-role-title">
                <GraduationCap size={19} />
                <strong>Student</strong>
              </span>
              <span>Take exams and view results</span>
            </button>
            <button
              type="button"
              className={audience === "teacher" ? "selected" : ""}
              aria-pressed={audience === "teacher"}
              onClick={() => {
                setAudience("teacher");
                setError("");
              }}
            >
              <span className="login-role-title">
                <ClipboardList size={18} />
                <strong>Teacher</strong>
              </span>
              <span>Manage classes and exams</span>
            </button>
          </div>
          {google && (
            <button
              className="primary large login-provider google-provider"
              onClick={() =>
                void signIn("google", {
                  callbackUrl: authCallbackUrl(audience),
                })
              }
            >
              <span className="google-mark" aria-hidden="true">
                G
              </span>
              <span>Continue with Google</span>
              <span className="provider-audience">{audience}</span>
            </button>
          )}
          {audience === "student" && google && (
            <p className="small muted" role="note">
              For kaushikka99@gmail.com, use Continue with Google. The email
              and password form is only for accounts with a SecureExam
              password.
            </p>
          )}
          {sso && (
            <button
              className="primary large login-provider login-sso-button"
              onClick={() =>
                void signIn("university", {
                  callbackUrl: authCallbackUrl(audience),
                })
              }
            >
              <ShieldCheck size={19} />
              <span>Continue with university SSO</span>
              <span className="provider-audience">{audience}</span>
            </button>
          )}
          {(google || sso) && (
            <div className="login-divider" aria-hidden="true">
              <span>or use your university email</span>
            </div>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                if (
                  audience === "student" &&
                  isGoogleOnlyStudentEmail(f.get("email"))
                ) {
                  await signIn(
                    "google",
                    { callbackUrl: authCallbackUrl("student") },
                    { prompt: "select_account" },
                  );
                  return;
                }
                const result = await signIn("credentials", {
                  email: f.get("email"),
                  password: f.get("password"),
                  otp: f.get("otp"),
                  redirect: false,
                });
                if (result?.error)
                  setError(
                    "Sign-in failed. Check your credentials and authenticator code, or contact your instructor.",
                  );
                else await completeSignIn(audience);
              } catch {
                setError("Unable to connect. Please retry.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              University email
              <input
                required
                autoComplete="username"
                name="email"
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="you@university.ac.th"
              />
            </label>
            <label>
              Password
              <input
                required={
                  audience !== "student" ||
                  !isGoogleOnlyStudentEmail(loginEmail)
                }
                autoComplete="current-password"
                name="password"
                type="password"
              />
            </label>
            <label>
              Authenticator code <span className="muted">if enabled</span>
              <input
                autoComplete="one-time-code"
                name="otp"
                inputMode="numeric"
                maxLength={6}
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary large" disabled={busy}>
              {busy ? "Signing in…" : `Sign in as ${audience}`}{" "}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="small muted">
            {audience === "student"
              ? "Use the university account assigned to you."
              : "Teacher access is provisioned by the university administrator."}
          </p>
          <Link href="/">← Back to SecureExam</Link>
        </div>
      </section>
    </main>
  );
}
