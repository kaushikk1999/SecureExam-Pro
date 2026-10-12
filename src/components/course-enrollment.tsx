"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { api } from "./ui";

export default function CourseEnrollment({
  courseId,
  token,
}: {
  courseId: string;
  token: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<{
    kind: "loading" | "success" | "error";
    message: string;
  }>({
    kind: "loading",
    message: "Joining the course…",
  });

  useEffect(() => {
    let active = true;
    void api(`courses/${courseId}/self-enroll`, { token })
      .then(() => {
        if (active)
          setState({
            kind: "success",
            message:
              "You’re enrolled. This course is now in your student workspace.",
          });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            kind: "error",
            message: (error as Error).message || "Could not join this course.",
          });
      });
    return () => {
      active = false;
    };
  }, [courseId, token]);

  return (
    <main className="login-page">
      <section className="login-form course-enrollment-result">
        <div aria-live="polite">
          <span className="brand-icon">
            {state.kind === "loading" ? (
              <LoaderCircle className="spin" />
            ) : state.kind === "success" ? (
              <CheckCircle2 />
            ) : (
              <ShieldCheck />
            )}
          </span>
          <h1>
            {state.kind === "loading"
              ? "Joining course"
              : state.kind === "success"
                ? "Course joined"
                : "Could not join course"}
          </h1>
          <p className="muted">{state.message}</p>
          {state.kind === "success" ? (
            <button
              className="primary large"
              onClick={() => router.replace("/workspace")}
            >
              Open student workspace
            </button>
          ) : state.kind === "error" ? (
            <Link className="primary large" href="/workspace">
              Go to student workspace
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
