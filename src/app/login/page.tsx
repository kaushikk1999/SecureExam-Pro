"use client";
import { useState, useEffect } from "react";
import { signIn, getProviders } from "next-auth/react";
import { ShieldCheck, ArrowRight, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  const [sso, setSso] = useState(false);
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    void getProviders()
      .then((p) => {
        setSso(Boolean(p?.university));
        setGoogle(Boolean(p?.google));
      })
      .catch(() => {});
    if (new URLSearchParams(window.location.search).has("error"))
      setError(
        "Google or university sign-in was not completed. Use an existing registered account, or sign in with your password and authenticator code.",
      );
  }, []);
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
          <h2>Welcome back</h2>
          <p className="muted">
            Sign in with your university examination account.
          </p>
          {google && (
            <button
              className="primary large"
              onClick={() =>
                void signIn("google", { callbackUrl: "/workspace" })
              }
            >
              Continue with Google
            </button>
          )}
          {sso && (
            <button
              className="primary large"
              onClick={() =>
                void signIn("university", { callbackUrl: "/workspace" })
              }
            >
              Continue with university SSO
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
                else router.push("/workspace");
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
              {busy ? "Signing in…" : "Sign in securely"}{" "}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="small muted">
            Accounts are provided by your instructor. Teacher registration is
            not public.
          </p>
          <Link href="/">← Back to SecureExam</Link>
        </div>
      </section>
    </main>
  );
}
