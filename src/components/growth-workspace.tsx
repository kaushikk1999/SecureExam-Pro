"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CheckCircle2,
  GraduationCap,
  Plug,
  FlaskConical,
  BarChart3,
  MessageSquare,
} from "lucide-react";
import type { Actor } from "@/lib/auth";
import { api, useData, ErrorBox, Loading, Markdown, time } from "./ui";
import styles from "./growth-workspace.module.css";

export const growthPages = [
  "practice",
  "actions",
  "learning",
  "analytics",
  "appeals",
  "integrations",
];
function useTask() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return {
    busy,
    error,
    message,
    run: async (fn: () => Promise<void>, success = "Saved successfully.") => {
      setBusy(true);
      setError("");
      setMessage("");
      try {
        await fn();
        setMessage(success);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
  };
}
function Feedback({ task }: { task: ReturnType<typeof useTask> }) {
  return (
    <>
      <ErrorBox message={task.error} />
      {task.message && (
        <p className={styles.success} role="status">
          {task.message}
        </p>
      )}
    </>
  );
}
function Intro({
  title,
  text,
  icon: Icon,
}: {
  title: string;
  text: string;
  icon: typeof Activity;
}) {
  return (
    <div className={styles.intro}>
      <span className={styles.icon}>
        <Icon size={25} />
      </span>
      <div>
        <span className="eyebrow">CONNECTED ASSESSMENT</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
export default function GrowthWorkspace({
  page,
  user,
}: {
  page: string;
  user: Actor;
}) {
  return (
    <div className={styles.root}>
      {page === "practice" ? (
        <Practice />
      ) : page === "actions" ? (
        <Actions />
      ) : page === "learning" ? (
        <Learning />
      ) : page === "analytics" ? (
        <Analytics />
      ) : page === "appeals" ? (
        <Appeals user={user} />
      ) : (
        <Integrations />
      )}
    </div>
  );
}
function Practice() {
  const { data, error } = useData("growth/practice");
  const task = useTask();
  const [answer, setAnswer] = useState({ choice: "", reflection: "" }),
    [version, setVersion] = useState(0),
    [checks, setChecks] = useState<Record<string, string>>({}),
    [loaded, setLoaded] = useState(false),
    [result, setResult] = useState(false),
    [saveAt, setSaveAt] = useState("");
  const alive = useRef(true),
    streams = useRef<MediaStream[]>([]);
  useEffect(() => {
    alive.current = true;
    const ownedStreams = streams.current;
    return () => {
      alive.current = false;
      ownedStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    };
  }, []);
  useEffect(() => {
    if (data && !loaded) {
      setAnswer(data.saved?.answer ?? { choice: "", reflection: "" });
      setVersion(Number(data.saved?.version ?? 0));
      setSaveAt(data.saved?.updated_at ?? "");
      setLoaded(true);
    }
  }, [data, loaded]);
  const check = async (kind: string) =>
    task.run(async () => {
      try {
        if (kind === "Connection") {
          const start = performance.now();
          await api("growth/practice");
          if (performance.now() - start > 10000)
            throw new Error(
              "The connection is slow. Retry on a stable network.",
            );
        } else if (kind === "Camera" || kind === "Microphone") {
          const stream = await navigator.mediaDevices.getUserMedia(
            kind === "Camera" ? { video: true } : { audio: true },
          );
          streams.current.push(stream);
          stream.getTracks().forEach((t) => t.stop());
        } else if (kind === "Fullscreen") {
          await document.documentElement.requestFullscreen();
          await document.exitFullscreen();
        } else if (kind === "Location") {
          await new Promise<void>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(
              () => resolve(),
              () =>
                reject(
                  new Error(
                    "Location was unavailable or permission was denied.",
                  ),
                ),
              { timeout: 10000, maximumAge: 0 },
            ),
          );
        }
        if (alive.current) setChecks((c) => ({ ...c, [kind]: "PASS" }));
      } catch (e) {
        if (alive.current) setChecks((c) => ({ ...c, [kind]: "FAIL" }));
        throw e;
      }
    }, kind + " check passed.");
  const save = () =>
    task.run(async () => {
      const next = version + 1;
      await api("growth/practice", { answer, version: next, checks });
      setVersion(next);
      const fresh = await api("growth/practice");
      if (
        Number(fresh.saved?.version) !== next ||
        JSON.stringify(fresh.saved.answer) !== JSON.stringify(answer)
      ) {
        // JSONB may return keys in a different order.
        if (
          Number(fresh.saved?.version) !== next ||
          fresh.saved.answer.choice !== answer.choice ||
          fresh.saved.answer.reflection !== answer.reflection
        )
          throw new Error("Read-back did not match. Reload and try again.");
      }
      setChecks((c) => ({ ...c, "Answer saving": "PASS" }));
      setSaveAt(fresh.saved.updated_at);
      setResult(true);
    }, "Practice saved and read back from the server.");
  return (
    <>
      <Intro
        title="Practice & readiness"
        text="Rehearse before exam day. These sample questions never affect your official attempts or grades."
        icon={FlaskConical}
      />
      <ErrorBox message={error} />
      <Feedback task={task} />
      <div className={styles.columns}>
        <section className={styles.card}>
          <h2>Check your setup</h2>
          <p>
            Checks apply to this browser now. Camera and microphone tracks stop
            immediately after testing. Your exam may require a different set of
            permissions.
          </p>
          {["Connection", "Camera", "Microphone", "Fullscreen", "Location"].map(
            (kind) => (
              <div className={styles.row} key={kind}>
                <span>
                  <strong>{kind}</strong>
                  <small>
                    {checks[kind] === "PASS"
                      ? "Passed this session"
                      : checks[kind] === "FAIL"
                        ? "Needs attention"
                        : "Not tested"}
                  </small>
                </span>
                <button disabled={task.busy} onClick={() => void check(kind)}>
                  Test {kind.toLowerCase()}
                </button>
              </div>
            ),
          )}
          <p className={styles.note}>
            A successful check is advisory; your exam’s entry checks still
            apply. No audio, video or location coordinates are stored here.
          </p>
        </section>
        <section className={styles.card}>
          <h2>A short practice exam</h2>
          <p>1. What is 2 + 2?</p>
          <fieldset className={styles.options}>
            <legend>Choose one answer</legend>
            {["4", "5", "6"].map((c) => (
              <label key={c}>
                <input
                  type="radio"
                  name="practice-choice"
                  value={c}
                  checked={answer.choice === c}
                  onChange={() => {
                    setAnswer((a) => ({ ...a, choice: c }));
                    setResult(false);
                  }}
                />
                {c}
              </label>
            ))}
          </fieldset>
          <label>
            2. Describe your preparation plan
            <textarea
              maxLength={3000}
              value={answer.reflection}
              onChange={(e) => {
                setAnswer((a) => ({ ...a, reflection: e.target.value }));
                setResult(false);
              }}
            />
          </label>
          <button
            className="primary"
            disabled={!loaded || task.busy}
            onClick={() => void save()}
          >
            Save & check practice answers
          </button>
          {saveAt && (
            <p className={styles.note}>
              Last server save: {time(saveAt)}. Reload this page to resume your
              saved practice.
            </p>
          )}
          {result && (
            <div className={styles.result}>
              <CheckCircle2 size={20} />
              <div>
                <strong>
                  {answer.choice === "4"
                    ? "Correct — 2 + 2 = 4."
                    : "The correct answer is 4."}
                </strong>
                <p>
                  Your reflection was saved. It is not graded. Answer saving
                  passed.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function Actions() {
  const { data, error, refresh } = useData("growth/actions", 15000);
  const task = useTask();
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <>
      <Intro
        title="Instructor action center"
        text="A clear queue of students who may need support. Refreshes every 15 seconds."
        icon={Activity}
      />
      <ErrorBox message={error} />
      <Feedback task={task} />
      {!data ? (
        error ? null : (
          <Loading />
        )
      ) : (
        <>
          <div className={styles.metrics}>
            {[
              ["Awaiting entry", data.pending.length],
              ["Connection attention", data.disconnected.length],
              ["Warnings to review", data.incidents.length],
              ["Open appeals", data.appeals],
            ].map(([label, value]) => (
              <div className={styles.card} key={label}>
                <strong className={styles.number}>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className={styles.columns}>
            <section className={styles.card}>
              <h2>Pending entry approvals</h2>
              {!data.pending.length && (
                <p>No students are waiting for entry approval.</p>
              )}
              {data.pending.map((r: any) => (
                <div className={styles.row} key={r.exam_id + r.user_id}>
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {r.title} · {time(r.created_at)}
                    </small>
                  </span>
                  <button
                    disabled={task.busy}
                    onClick={() =>
                      void task.run(async () => {
                        await api(`exams/${r.exam_id}/checkin`, {
                          studentId: r.user_id,
                        });
                        await refresh();
                      }, "Entry approved.")
                    }
                  >
                    Approve entry
                  </button>
                </div>
              ))}
            </section>
            <section className={styles.card}>
              <h2>Connection needs attention</h2>
              <p>
                A heartbeat older than 90 seconds means the connection may need
                help. It is not evidence of misconduct.
              </p>
              {!data.disconnected.length && <p>No stale active sessions.</p>}
              {data.disconnected.map((r: any) => (
                <div className={styles.row} key={r.id}>
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      {r.title} · last contact {time(r.last_heartbeat_at)}
                    </small>
                  </span>
                  <Link href={"/workspace/exams/" + r.exam_id}>
                    Open exam →
                  </Link>
                </div>
              ))}
            </section>
          </div>
          <section className={styles.card}>
            <h2>Warning reviews</h2>
            <p>
              Showing up to 100 unreviewed warnings. Review the exam evidence
              before recording your note. This does not waive a warning.
            </p>
            {!data.incidents.length && (
              <p>All warning events have been reviewed.</p>
            )}
            {data.incidents.map((r: any) => (
              <details key={r.id} className={styles.details}>
                <summary>
                  {r.name} · {r.title} · {time(r.created_at)} — review warning
                </summary>
                <form
                  className={styles.case}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void task.run(async () => {
                      await api("growth/actions", {
                        eventId: r.id,
                        note: notes[r.id],
                      });
                      await refresh();
                    }, "Review recorded.");
                  }}
                >
                  <div className={styles.row}>
                    <span>
                      <strong>
                        {r.name} · {r.title}
                      </strong>
                      <small>
                        {time(r.created_at)} · {r.severity}
                      </small>
                    </span>
                    <Link href={"/workspace/exams/" + r.exam_id}>
                      View examination →
                    </Link>
                  </div>
                  <label>
                    Review note
                    <textarea
                      required
                      minLength={10}
                      maxLength={4000}
                      value={notes[r.id] ?? ""}
                      onChange={(e) =>
                        setNotes({ ...notes, [r.id]: e.target.value })
                      }
                    />
                  </label>
                  <button disabled={task.busy}>Mark reviewed</button>
                </form>
              </details>
            ))}
          </section>
          <Link className="button" href="/workspace/appeals">
            Review appeals ({data.appeals}) →
          </Link>
        </>
      )}
    </>
  );
}
function Learning() {
  const { data, error } = useData("growth/learning");
  return (
    <>
      <Intro
        title="Your learning journey"
        text="Feedback and topic progress from completed exams whose results have been released."
        icon={GraduationCap}
      />
      <ErrorBox message={error} />
      {!data ? (
        error ? null : (
          <Loading />
        )
      ) : (
        <>
          <div className={styles.columns}>
            <section className={styles.card}>
              <h2>Topic progress</h2>
              <p>
                Percentage of available marks earned on graded responses. These
                figures describe your assessments, not a diagnosis of ability.
              </p>
              {!data.topics.length && (
                <p>
                  Topic progress will appear after graded results are released.
                </p>
              )}
              {data.topics.map((t: any) => (
                <div className={styles.topic} key={t.topic}>
                  <div>
                    <strong>{t.topic}</strong>
                    <span>{Math.round((100 * t.earned) / t.possible)}%</span>
                  </div>
                  <progress
                    max={100}
                    value={Math.max(
                      0,
                      Math.min(100, (100 * t.earned) / t.possible),
                    )}
                    aria-label={t.topic + " marks earned"}
                  />
                  <small>
                    {t.earned} / {t.possible} marks · {t.count} graded responses
                  </small>
                </div>
              ))}
            </section>
            <section className={styles.card}>
              <h2>Progress across exams</h2>
              {!data.attempts.length && (
                <p>
                  No released results yet. Your instructor controls when grades
                  become visible.
                </p>
              )}
              {data.attempts.map((a: any) => (
                <div className={styles.row} key={a.id}>
                  <span>
                    <strong>{a.title}</strong>
                    <small>
                      {a.course_code ?? a.code} · {time(a.submitted_at)}
                    </small>
                  </span>
                  <strong>
                    {a.score === null
                      ? "Grading pending"
                      : `${Number(a.score)} / ${Number(a.maximum)}`}
                  </strong>
                </div>
              ))}
            </section>
          </div>
          {data.attempts.map((a: any) => (
            <section className={styles.card} key={a.id}>
              <h2>{a.title} · feedback</h2>
              {a.feedback ? (
                <Markdown text={a.feedback} />
              ) : (
                <p>No overall instructor feedback yet.</p>
              )}
              {data.responses
                .filter((r: any) => r.attempt_id === a.id)
                .map((r: any, i: number) => (
                  <details key={i} className={styles.details}>
                    <summary>
                      {r.topic || "Question"} ·{" "}
                      {r.mark === null
                        ? "Awaiting grading"
                        : `${Number(r.mark)} / ${Number(r.marks)} marks`}
                    </summary>
                    <Markdown text={r.prompt} />
                    <p>{r.feedback || "No question feedback provided."}</p>
                  </details>
                ))}
            </section>
          ))}
        </>
      )}
    </>
  );
}
function Analytics() {
  const { data, error } = useData("growth/analytics");
  const [filter, setFilter] = useState("");
  return (
    <>
      <Intro
        title="Question analytics"
        text="Use completed, graded responses to guide your next question review."
        icon={BarChart3}
      />
      <ErrorBox message={error} />
      <section className={styles.card}>
        <label>
          Filter by topic or question
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search your questions"
          />
        </label>
        <p>
          Average credit is earned marks divided by possible marks. Low credit
          can reflect difficulty, teaching coverage or ambiguity; review context
          before changing a question. Fewer than 10 responses is a small sample.
        </p>
      </section>
      {!data ? (
        error ? null : (
          <Loading />
        )
      ) : data.length === 0 ? (
        <section className={styles.card}>
          Analytics appear when students submit answers and grading is
          available.
        </section>
      ) : (
        data
          .filter((q: any) =>
            (q.prompt + " " + q.topic)
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
          .map((q: any) => (
            <section className={styles.card} key={q.id}>
              <span className={styles.tag}>
                {q.topic} · {q.type}
              </span>
              <Markdown text={q.prompt} />
              <div className={styles.metrics}>
                <div>
                  <strong className={styles.number}>{q.responses}</strong>Graded
                  responses
                </div>
                <div>
                  <strong className={styles.number}>
                    {Math.round(q.credit)}%
                  </strong>
                  Average credit
                </div>
                <div>
                  <strong className={styles.number}>
                    {Math.round((100 * q.blank) / q.responses)}%
                  </strong>
                  Blank responses
                </div>
              </div>
              {q.smallSample && (
                <p className={styles.note}>
                  Small sample — interpret with caution.
                </p>
              )}
              {q.credit < 40 && (
                <p className={styles.note}>
                  Low average credit — consider reviewing wording and topic
                  coverage.
                </p>
              )}
              {Object.keys(q.distribution).length > 0 && (
                <details className={styles.details}>
                  <summary>Answer distribution</summary>
                  {Object.entries(q.distribution).map(([answer, count]) => (
                    <div className={styles.row} key={answer}>
                      <span>{answer}</span>
                      <strong>{String(count)}</strong>
                    </div>
                  ))}
                </details>
              )}
              <Link href="/workspace/questions">Open question bank →</Link>
            </section>
          ))
      )}
    </>
  );
}
function Appeals({ user }: { user: Actor }) {
  const { data, error, refresh } = useData("growth/appeals");
  const task = useTask();
  const student = user.role === "STUDENT";
  return (
    <>
      <Intro
        title={student ? "Your incident appeals" : "Incident appeals"}
        text="A space for explanations, evidence review and documented decisions. An appeal does not automatically change marks or warnings."
        icon={MessageSquare}
      />
      <ErrorBox message={error} />
      <Feedback task={task} />
      {!data ? (
        error ? null : (
          <Loading />
        )
      ) : (
        <>
          {student && (
            <section className={styles.card}>
              <h2>Explain a recorded warning</h2>
              {!data.events.length ? (
                <p>No warnings are available for a new appeal.</p>
              ) : (
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const f = new FormData(form);
                    void task.run(async () => {
                      await api("growth/appeals", {
                        eventId: f.get("eventId"),
                        message: f.get("message"),
                      });
                      form.reset();
                      await refresh();
                    }, "Your explanation was submitted.");
                  }}
                >
                  <label>
                    Warning event
                    <select name="eventId" required>
                      {data.events.map((ev: any) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.title} · {time(ev.created_at)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Your explanation
                    <textarea
                      name="message"
                      required
                      minLength={10}
                      maxLength={4000}
                    />
                  </label>
                  <button className="primary" disabled={task.busy}>
                    Submit appeal
                  </button>
                </form>
              )}
            </section>
          )}
          {!data.cases.length && (
            <section className={styles.card}>No appeals to display.</section>
          )}
          {data.cases.map((p: any) => (
            <section className={styles.card} key={p.id}>
              <div className={styles.row}>
                <div>
                  <span className={styles.tag}>
                    {p.status.replaceAll("_", " ")}
                  </span>
                  <h2>{p.title}</h2>
                  <p>
                    {p.name} · warning at {time(p.event_at)}
                  </p>
                </div>
                {!student && (
                  <Link href="/workspace/monitor">Review exam evidence →</Link>
                )}
              </div>
              <ol className={styles.timeline}>
                {data.messages
                  .filter((m: any) => m.appeal_id === p.id)
                  .map((m: any) => (
                    <li key={m.id}>
                      <strong>
                        {m.name} · {m.status.replaceAll("_", " ")}
                      </strong>
                      <small>{time(m.created_at)}</small>
                      <p>{m.message}</p>
                    </li>
                  ))}
              </ol>
              {((!student && ["OPEN", "UNDER_REVIEW"].includes(p.status)) ||
                (student &&
                  !p.reopened &&
                  ["UPHELD", "DISMISSED"].includes(p.status))) && (
                <form
                  className={styles.form}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void task.run(
                      async () => {
                        await api(`growth/appeals/${p.id}/update`, {
                          version: p.version,
                          status: student ? "OPEN" : f.get("status"),
                          message: f.get("message"),
                        });
                        await refresh();
                      },
                      student
                        ? "Appeal reopened for another review."
                        : "Decision history updated.",
                    );
                  }}
                >
                  {!student && (
                    <label>
                      Review outcome
                      <select name="status">
                        <option value="UNDER_REVIEW">Under review</option>
                        <option value="UPHELD">
                          Appeal upheld — accept explanation
                        </option>
                        <option value="DISMISSED">
                          Appeal dismissed — explanation not accepted
                        </option>
                      </select>
                    </label>
                  )}
                  <label>
                    {student
                      ? "Additional information (one reopening allowed)"
                      : "Reason for this decision"}
                    <textarea
                      required
                      name="message"
                      minLength={10}
                      maxLength={4000}
                    />
                  </label>
                  <button disabled={task.busy}>
                    {student ? "Request another review" : "Record review"}
                  </button>
                </form>
              )}
            </section>
          ))}
        </>
      )}
    </>
  );
}
function Integrations() {
  const { data, error, refresh } = useData("growth/integrations");
  const task = useTask();
  return (
    <>
      <Intro
        title="Sign-in integrations"
        text="Administrator-managed Google and university sign-in."
        icon={Plug}
      />
      <ErrorBox message={error} />
      <Feedback task={task} />
      {!data ? (
        error ? null : <Loading />
      ) : (
        <section className={styles.card}>
          <h2>Google & university login</h2>
          <div className={styles.row}>
            <span>Google login</span>
            <strong>
              {data.google?.configured ? "Configured" : "Not configured"}
            </strong>
          </div>
          <p>
            Google login can create accounts for verified Workspace domains
            listed in GOOGLE_AUTO_PROVISION_DOMAINS. New users start as
            students; only exact addresses listed in GOOGLE_TEACHER_EMAILS
            receive teacher access. Existing roles are preserved. Configure
            these settings and the Google OAuth credentials on the server.
          </p>
          <div className={styles.row}>
            <span>Optional OpenID Connect</span>
            <strong>
              {data.sso.configured ? "Configured" : "Not configured"}
            </strong>
          </div>
          <p>
            Custom university providers use an administrator-approved issuer
            and subject mapping. Existing passwords and roles stay intact.
          </p>
          {data.sso.configured && (
            <>
              <p>Issuer: {data.sso.issuer}</p>
              <form
                className={styles.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void task.run(async () => {
                    await api("growth/integrations/identity", {
                      email: f.get("email"),
                      subject: f.get("subject"),
                      remove: f.get("mode") === "remove",
                    });
                    await refresh();
                  });
                }}
              >
                <label>
                  Existing account email
                  <input name="email" type="email" required />
                </label>
                <label>
                  Provider subject identifier
                  <input name="subject" required maxLength={255} />
                </label>
                <label>
                  Action
                  <select name="mode">
                    <option value="add">Link identity</option>
                    <option value="remove">
                      Unlink identity and revoke sessions
                    </option>
                  </select>
                </label>
                <button disabled={task.busy}>Save identity mapping</button>
              </form>
              {data.identities.map((i: any) => (
                <p key={i.subject}>
                  {i.email} · {i.subject}
                </p>
              ))}
            </>
          )}
        </section>
      )}
    </>
  );
}
