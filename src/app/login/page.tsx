"use client";
import { useState, useEffect } from "react";
import { signIn, signOut, getProviders } from "next-auth/react";
import { ShieldCheck, ArrowRight, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { matchesLoginAudience, safeStudentReturnPath } from "@/lib/auth-role";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState<"student" | "teacher">("student");

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
          ? "For student Google sign-in, use the account approved for your class. Bangkok University student Workspace accounts usually end in @bumail.net. If you still cannot sign in, contact your instructor or BU IT."
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
          <span className="brand-icon">
            <LockKeyhole />
          </span>
          <h2>
            {audience === "student" ? "Student sign in" : "Teacher sign in"}
          </h2>
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
              <strong>Student</strong>
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
              <strong>Teacher</strong>
              <span>Manage classes and exams</span>
            </button>
          </div>
          {google && (
            <button
              className="primary large"
              onClick={() =>
                void signIn("google", {
                  callbackUrl: authCallbackUrl(audience),
                })
              }
            >
              Continue as {audience} with Google
            </button>
          )}
          {sso && (
            <button
              className="primary large"
              onClick={() =>
                void signIn("university", {
                  callbackUrl: authCallbackUrl(audience),
                })
              }
            >
              Continue as {audience} with university SSO
            </button>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
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
                placeholder="you@university.ac.th"
              />
            </label>
            <label>
              Password
              <input
                required
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
