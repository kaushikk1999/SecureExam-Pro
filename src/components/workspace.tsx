"use client";
import GrowthWorkspace, { growthPages } from "./growth-workspace";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  ShieldCheck,
  LayoutDashboard,
  FileText,
  Users,
  Library,
  MapPin,
  Activity,
  ClipboardList,
  Settings,
  LogOut,
  ArrowUpRight,
  Plus,
  Search,
  Bell,
  GraduationCap,
  ChevronRight,
  CheckCircle2,
  Clock3,
  Radio,
  Menu,
  X,
} from "lucide-react";
import type { Actor } from "@/lib/auth";
import { COURSE_CATALOG } from "@/lib/course-data";
import ExamQrDialog from "./exam-qr-dialog";
import {
  api,
  useData,
  Status,
  Markdown,
  RichEditor,
  ErrorBox,
  Empty,
  time,
  setDisplayTimezone,
  Loading,
} from "./ui";
const nav = [
  ["", "Overview", LayoutDashboard],
  ["exams", "Examinations", FileText],
  ["students", "Students & courses", Users],
  ["questions", "Question bank", Library],
  ["classrooms", "Classrooms", MapPin],
  ["monitor", "Live monitoring", Activity],
  ["audit", "Login & audit", ClipboardList],
  ["actions", "Action center", Activity],
  ["practice", "Practice & readiness", CheckCircle2],
  ["learning", "My learning", GraduationCap],
  ["analytics", "Question analytics", Library],
  ["appeals", "Incident appeals", ClipboardList],
  ["integrations", "University integrations", Settings],
  ["settings", "Settings", Settings],
] as const;
export default function Workspace({
  user,
  view,
}: {
  user: Actor;
  view: string[];
}) {
  const { data: settings } = useData("settings");
  useEffect(() => {
    if (settings?.timezone) setDisplayTimezone(settings.timezone);
  }, [settings?.timezone]);
  const [open, setOpen] = useState(false);
  const page = view[0] ?? "";
  return (
    <div
      className="app-shell"
      style={
        { "--accent": settings?.accent ?? "#2563eb" } as React.CSSProperties
      }
    >
      <aside className={open ? "sidebar open" : "sidebar"}>
        <Link href="/workspace" className="brand">
          <span className="brand-icon">
            {settings?.logo ? (
              <Image
                src={settings.logo}
                alt="Institution logo"
                width={28}
                height={28}
                unoptimized
              />
            ) : (
              <ShieldCheck size={22} />
            )}
          </span>
          {settings?.brand ?? "SecureExam Pro"}
        </Link>
        <div className="institution">
          <span className="institution-icon">
            <GraduationCap size={23} />
          </span>
          <div>
            <strong>{settings?.institution ?? "Bangkok University"}</strong>
            <small>EXAMINATION WORKSPACE</small>
          </div>
        </div>
        <div className="nav-label">
          {user.role === "STUDENT" ? "STUDENT PORTAL" : "TEACHING & ASSESSMENT"}
        </div>
        <nav>
          {(user.role === "STUDENT"
            ? nav.filter((n) =>
                ["", "exams", "practice", "learning", "appeals"].includes(n[0]),
              )
            : nav.filter(
                (n) =>
                  n[0] !== "learning" &&
                  (n[0] !== "integrations" || user.role === "ADMIN"),
              )
          ).map(([href, label, Icon]) => (
            <Link
              onClick={() => setOpen(false)}
              href={"/workspace/" + href}
              className={page === href ? "nav-item selected" : "nav-item"}
              key={href}
            >
              <Icon size={19} />
              {label}
              {href === "monitor" && <span className="nav-live" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note">
            <ShieldCheck size={20} />
            <strong>Integrity with context</strong>
            <p>
              Signals support your judgment.
              <br />
              They don’t replace it.
            </p>
          </div>
          <button
            className="profile"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <span className="avatar">
              {user.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </span>
            <span>
              <strong>{user.name}</strong>
              <small>{user.role.toLowerCase()} workspace</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
          <span>
            Workspace <ChevronRight size={14} />{" "}
            <strong>
              {nav.find((n) => n[0] === page)?.[1] ?? "Examination"}
            </strong>
          </span>
          <div>
            <span className="small muted">
              {settings?.timezone ?? "Asia/Bangkok"}
            </span>
            <Link href="/workspace/audit" aria-label="Audit activity">
              <Bell size={19} />
            </Link>
            <span className="avatar small-avatar">{user.name[0]}</span>
          </div>
        </header>
        <main className="main-content">
          {growthPages.includes(page) ? (
            <GrowthWorkspace key={page} page={page} user={user} />
          ) : user.role === "STUDENT" ? (
            <StudentHome user={user} />
          ) : page === "exams" ? (
            view[1] ? (
              <ExamDetail id={view[1]} />
            ) : (
              <ExamList />
            )
          ) : page === "students" ? (
            <Students />
          ) : page === "questions" ? (
            <QuestionBank />
          ) : page === "classrooms" ? (
            <Classrooms />
          ) : page === "monitor" ? (
            <MonitorPage />
          ) : page === "audit" ? (
            <Audit />
          ) : page === "settings" ? (
            <SettingsPage isAdmin={user.role === "ADMIN"} />
          ) : (
            <Overview user={user} />
          )}
        </main>
        <footer className="workspace-footer">
          SecureExam Pro{" "}
          <span>
            Thoughtfully built for fair assessment ·{" "}
            {settings?.timezone ?? "Asia/Bangkok"}
          </span>
        </footer>
      </div>
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
function Overview({ user }: { user: Actor }) {
  const { data: exams, error } = useData("exams", 10000);
  const { data: students } = useData("students");
  const { data: events } = useData("audit", 15000);
  return (
    <>
      <Heading
        eyebrow="YOUR TEACHING, AT A GLANCE"
        title={"Good to see you, " + user.name.split(" ")[0] + "."}
        description="A little clarity before your next examination."
      >
        <Link className="button primary" href="/workspace/exams?new=1">
          <Plus size={17} /> Create examination
        </Link>
      </Heading>
      <ErrorBox message={error} />
      <div className="welcome-banner">
        <div>
          <span className="eyebrow">READY FOR WHAT’S NEXT</span>
          <h2>
            Less administration.
            <br />
            More room for learning.
          </h2>
          <p>
            Prepare your questions, bring your class together,
            <br />
            and follow every exam from one place.
          </p>
          <Link href="/workspace/exams">
            Manage examinations <ArrowUpRight size={16} />
          </Link>
        </div>
        <div className="banner-art">
          <div className="orbit" />
          <ShieldCheck size={84} strokeWidth={1} />
          <span>
            <CheckCircle2 size={14} /> Instructor-led assessment
          </span>
        </div>
      </div>
      <div className="stat-grid">
        {[
          [
            FileText,
            exams?.length ?? "—",
            "Examinations",
            "Across your courses",
          ],
          [
            Users,
            students?.length ?? "—",
            "Enrolled students",
            "Your teaching community",
          ],
          [
            Radio,
            exams?.filter(
              (e: any) =>
                ["LIVE", "PUBLISHED"].includes(e.status) &&
                new Date(e.starts_at) <= new Date() &&
                new Date(e.ends_at) > new Date(),
            ).length ?? "—",
            "Open examinations",
            "Ready for live supervision",
          ],
          [
            ShieldCheck,
            events?.filter((e: any) => e.event_type === "WARNING_ISSUED")
              .length ?? "—",
            "Warnings recorded",
            "Recent audit window",
          ],
        ].map(([Icon, value, label, caption]: any) => (
          <article className="stat" key={label}>
            <span className="stat-icon">
              <Icon size={20} />
            </span>
            <strong>{value}</strong>
            <h3>{label}</h3>
            <small>{caption}</small>
          </article>
        ))}
      </div>
      <div className="two-column">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Examinations</h2>
              <p>Recently created assessments</p>
            </div>
            <Link href="/workspace/exams">View all →</Link>
          </div>
          {!exams ? (
            <Loading />
          ) : !exams.length ? (
            <Empty
              title="A fresh semester starts here"
              description="Create a course, enroll your students, then prepare your first examination."
            />
          ) : (
            exams.slice(0, 4).map((e: any) => (
              <Link
                className="exam-row"
                href={"/workspace/exams/" + e.id}
                key={e.id}
              >
                <span className="exam-icon">
                  <FileText size={22} />
                </span>
                <div>
                  <strong>{e.title}</strong>
                  <small>
                    {e.course_code} · {e.duration_minutes} min ·{" "}
                    {time(e.starts_at)}
                  </small>
                </div>
                <Status value={e.status} />
                <ChevronRight size={17} />
              </Link>
            ))
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Recent activity</h2>
              <p>Your examination audit trail</p>
            </div>
            <Activity size={19} />
          </div>
          <div className="activity-list">
            {events?.slice(0, 5).map((e: any) => (
              <div key={e.id}>
                <span
                  className={
                    "activity-dot " + (e.severity === "HIGH" ? "red" : "")
                  }
                />
                <div>
                  <strong>
                    {e.event_type.replaceAll("_", " ").toLowerCase()}
                  </strong>
                  <p>
                    {e.name ?? "System"} <small>· {time(e.created_at)}</small>
                  </p>
                </div>
              </div>
            ))}
            {events?.length === 0 && (
              <Empty
                title="All quiet for now"
                description="Exam and account activity will appear here."
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
const standard = {
  camera: true,
  microphone: false,
  location: true,
  screen: false,
  fullscreen: true,
  classroomCode: true,
  teacherApproval: false,
  allowCopy: false,
  allowPaste: false,
  maxWarnings: 5,
  autoTerminate: true,
  randomize: true,
  shuffleOptions: true,
  poolSize: 0,
  allowMobile: false,
  tabMonitoring: true,
  navigation: true,
  allowDownload: false,
  negativeMarks: 0,
  retentionDays: 90,
  offlineGraceSeconds: 120,
};
function ExamList() {
  const { data: exams, error, refresh } = useData("exams");
  const [creating, setCreating] = useState(false),
    [search, setSearch] = useState("");
  useEffect(() => {
    setCreating(new URLSearchParams(window.location.search).has("new"));
  }, []);
  return (
    <>
      <Heading
        eyebrow="PLAN. PREPARE. PUBLISH."
        title="Examinations"
        description="A home for every assessment, from first draft to final marks."
      >
        <button className="primary" onClick={() => setCreating(!creating)}>
          <Plus size={17} /> Create examination
        </button>
      </Heading>
      <ErrorBox message={error} />
      {creating && (
        <ExamForm
          done={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
      <div className="list-tools">
        <Search size={18} />
        <input
          aria-label="Search examinations"
          placeholder="Find an examination…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="muted">{exams?.length ?? 0} examinations</span>
      </div>
      <div className="exam-grid">
        {exams
          ?.filter((e: any) =>
            e.title.toLowerCase().includes(search.toLowerCase()),
          )
          .map((e: any) => (
            <Link
              className="exam-card"
              key={e.id}
              href={"/workspace/exams/" + e.id}
            >
              <div>
                <span className="course-tag">{e.course_code}</span>
                <Status value={e.status} />
              </div>
              <h2>{e.title}</h2>
              <p>
                <Clock3 size={15} /> {e.duration_minutes} minutes <span>·</span>{" "}
                {time(e.starts_at)}
              </p>
              <div className="exam-card-bottom">
                <span>
                  <Users size={16} /> {e.enrolled} assigned · {e.attended}{" "}
                  checked in
                </span>
                <ArrowUpRight size={19} />
              </div>
            </Link>
          ))}
      </div>
      {exams?.length === 0 && (
        <Empty
          title="Build your first examination"
          description="Start with a course and a classroom, then add questions from your question bank."
        />
      )}
    </>
  );
}
function ExamForm({ done, initial }: { done: () => void; initial?: any }) {
  const router = useRouter();
  const [formNow] = useState(() => Date.now());
  const { data: courses } = useData("courses"),
    { data: rooms } = useData("classrooms");
  const [policy, setPolicy] = useState(initial?.policy ?? standard),
    [instructions, setInstructions] = useState(initial?.instructions ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function date(v?: string) {
    const d = v ? new Date(v) : new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  return (
    <section className="panel form-panel">
      <h2>{initial ? "Edit draft" : "A new examination"}</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            const result = await api(
              "exams" + (initial ? "/" + initial.id : ""),
              {
                title: f.get("title"),
                courseId: f.get("course"),
                startsAt: new Date(String(f.get("start"))).toISOString(),
                endsAt: new Date(String(f.get("end"))).toISOString(),
                duration: Number(f.get("duration")),
                passingScore: Number(f.get("pass")),
                instructions,
                policy,
                classroom:
                  rooms?.find((r: any) => r.id === f.get("room"))
                    ?.configuration ??
                  initial?.classroom ??
                  null,
              },
              initial ? "PATCH" : "POST",
            );
            done();
            if (!initial) router.push("/workspace/exams/" + result.id);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Exam title
            <input
              required
              name="title"
              defaultValue={initial?.title}
              placeholder="Data Structures · Midterm"
            />
          </label>
          <label>
            Course / section
            <select required name="course" defaultValue={initial?.course_id}>
              <option value="">Select course</option>
              {courses?.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name} · {c.section}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opens (your device timezone)
            <input
              required
              name="start"
              type="datetime-local"
              defaultValue={date(initial?.starts_at)}
            />
          </label>
          <label>
            Closes (your device timezone)
            <input
              required
              name="end"
              type="datetime-local"
              defaultValue={date(
                initial?.ends_at ?? new Date(formNow + 7200000).toISOString(),
              )}
            />
          </label>
          <label>
            Duration (minutes)
            <input
              required
              type="number"
              min={1}
              max={600}
              name="duration"
              defaultValue={initial?.duration_minutes ?? 90}
            />
          </label>
          <label>
            Passing score (%)
            <input
              type="number"
              min={0}
              max={100}
              name="pass"
              defaultValue={initial?.passing_score ?? 50}
            />
          </label>
          <label>
            Classroom
            <select name="room">
              <option value="">
                {initial?.classroom
                  ? "Keep " + initial.classroom.name
                  : "No classroom"}
              </option>
              {rooms?.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Security preset
            <select
              defaultValue="standard"
              onChange={(e) =>
                setPolicy(
                  e.target.value === "strict"
                    ? { ...standard, microphone: true }
                    : e.target.value === "practice"
                      ? {
                          ...standard,
                          camera: false,
                          location: false,
                          fullscreen: false,
                          classroomCode: false,
                          allowCopy: true,
                          allowPaste: true,
                          tabMonitoring: false,
                          allowMobile: true,
                          autoTerminate: false,
                        }
                      : standard,
                )
              }
            >
              <option value="standard">Standard exam</option>
              <option value="strict">Strict exam</option>
              <option value="practice">Practice / quiz</option>
            </select>
          </label>
        </div>
        <label>Instructions</label>
        <RichEditor value={instructions} onChange={setInstructions} />
        <details>
          <summary>Customize monitoring & examination policy</summary>
          <div className="check-grid">
            {Object.entries(policy)
              .filter(([, v]) => typeof v === "boolean")
              .map(([key, value]) => (
                <label key={key} className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) =>
                      setPolicy({ ...policy, [key]: e.target.checked })
                    }
                  />
                  {key.replace(/([A-Z])/g, " $1")}
                </label>
              ))}
          </div>
          <div className="form-grid">
            {[
              ["maxWarnings", "Warning limit"],
              ["poolSize", "Questions drawn from pool (0 = all)"],
              ["negativeMarks", "Penalty for incorrect objective answer"],
              ["retentionDays", "Retention (days)"],
              ["offlineGraceSeconds", "Offline review threshold (seconds)"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={key === "maxWarnings" ? 1 : 0}
                  value={policy[key]}
                  onChange={(e) =>
                    setPolicy({ ...policy, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        <ErrorBox message={error} />
        <div className="actions">
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save draft"}
          </button>
          <button type="button" onClick={done}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
function ExamDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data: e, error, refresh } = useData("exams/" + id);
  const { data: bank } = useData("questions");
  const [tab, setTab] = useState("questions"),
    [message, setMessage] = useState(""),
    [editing, setEditing] = useState(false),
    [code, setCode] = useState("");
  async function action(a: string) {
    try {
      if (
        ["close", "archive"].includes(a) &&
        !confirm("This submits all active attempts. Continue?")
      )
        return;
      const minutes =
        a === "extend" ? Number(prompt("Extra minutes", "15")) : undefined;
      await api(`exams/${id}/control`, { action: a, minutes });
      await refresh();
      setMessage("Change saved.");
    } catch (err) {
      setMessage((err as Error).message);
    }
  }
  if (error) return <ErrorBox message={error} />;
  if (!e) return <Loading />;
  return (
    <>
      <Heading
        eyebrow={e.course_code + " · " + e.course_name}
        title={e.title}
        description={`${e.duration_minutes} minutes · ${time(e.starts_at)} – ${time(e.ends_at)}`}
      >
        <Status value={e.status} />
        {e.status === "DRAFT" && (
          <button className="primary" onClick={() => action("publish")}>
            Publish examination <ArrowUpRight size={16} />
          </button>
        )}
      </Heading>
      <div className="actions action-bar">
        {e.status !== "DRAFT" && e.status !== "ARCHIVED" && (
          <ExamQrDialog
            examId={id}
            title={e.title}
            courseCode={e.course_code}
            courseName={e.course_name}
            section={e.course_section}
          />
        )}
        {e.status === "DRAFT" && (
          <button onClick={() => setEditing(!editing)}>
            Edit configuration
          </button>
        )}
        <button
          onClick={async () => {
            const r = await api(`exams/${id}/duplicate`, {});
            router.push("/workspace/exams/" + r.id);
          }}
        >
          Duplicate
        </button>
        <button
          onClick={() => action(e.status === "PAUSED" ? "resume" : "pause")}
        >
          {e.status === "PAUSED" ? "Resume" : "Pause"} exam
        </button>
        <button onClick={() => action("extend")}>Add time</button>
        <button onClick={() => action("close")}>Close exam</button>
        <button onClick={() => action("release")}>Release results</button>
        <button onClick={() => action("archive")}>Archive</button>
        <button
          onClick={async () => {
            const c = await api(`exams/${id}/room-code`);
            setCode(c.code + " · valid until " + time(c.expiresAt));
          }}
        >
          Show room code
        </button>
      </div>
      {code && (
        <div className="room-code">
          {code}
          <small>This code is valid for 5 minutes. Refresh after it expires.</small>
        </div>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {editing && (
        <ExamForm
          initial={e}
          done={() => {
            setEditing(false);
            void refresh();
          }}
        />
      )}
      <div className="tabs">
        {["questions", "monitor", "reports", "accommodations"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "questions" ? (
        <div className="two-column">
          <section className="panel form-panel">
            <h2>
              Question paper{" "}
              <span className="muted">{e.questions.length} questions</span>
            </h2>
            <Markdown text={e.instructions} />
            {e.questions.map((q: any, i: number) => (
              <div key={q.id} className="question-preview">
                <div className="eyebrow">
                  QUESTION {i + 1} · {q.type.replaceAll("_", " ")} · {q.marks}{" "}
                  MARKS
                </div>
                <Markdown text={q.prompt} />
                {e.status === "DRAFT" && (
                  <button
                    onClick={async () => {
                      await api(`exams/${id}/questions`, {
                        questionId: q.id,
                        remove: true,
                      });
                      await refresh();
                    }}
                  >
                    Remove from paper
                  </button>
                )}
              </div>
            ))}
            {!e.questions.length && (
              <Empty
                title="Your paper is a blank canvas"
                description="Add questions from your bank to get started."
              />
            )}
          </section>
          <aside>
            <section className="panel form-panel">
              <h2>Add from question bank</h2>
              <p className="muted">
                Published papers are immutable. Duplicate an exam to revise it.
              </p>
              {e.status === "DRAFT" && (
                <select
                  aria-label="Attach question"
                  value=""
                  onChange={async (ev) => {
                    try {
                      await api(`exams/${id}/questions`, {
                        questionId: ev.target.value,
                      });
                      await refresh();
                    } catch (err) {
                      setMessage((err as Error).message);
                    }
                  }}
                >
                  <option value="">Select a question…</option>
                  {bank
                    ?.filter(
                      (q: any) => !e.questions.some((x: any) => x.id === q.id),
                    )
                    .map((q: any) => (
                      <option key={q.id} value={q.id}>
                        {q.prompt.slice(0, 100)}
                      </option>
                    ))}
                </select>
              )}
              <Link className="button" href="/workspace/questions">
                Open question bank →
              </Link>
            </section>
            <section className="panel form-panel">
              <h2>Supporting materials</h2>
              <p className="muted">PDF, DOCX, images or text · maximum 4 MB.</p>
              {e.status === "DRAFT" && (
                <Upload examId={id} done={() => void refresh()} />
              )}
              {e.files.map((f: any) => (
                <p key={f.id}>
                  <Link
                    href={"/api/platform/files/" + f.id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {f.name}
                  </Link>
                  {f.extracted_text && (
                    <details>
                      <summary>
                        Extracted text · review before importing
                      </summary>
                      <pre>{f.extracted_text}</pre>
                    </details>
                  )}
                </p>
              ))}
            </section>
          </aside>
        </div>
      ) : tab === "monitor" ? (
        <Monitor id={id} policy={e.policy} />
      ) : tab === "reports" ? (
        <section className="panel form-panel">
          <h2>Attendance & results</h2>
          <p>
            Exports include every assigned student, submission status, warnings
            and released or pending marks.
          </p>
          <div className="actions">
            <a
              className="button primary"
              href={`/api/platform/exams/${id}/export`}
            >
              Download CSV
            </a>
            <a
              className="button"
              href={`/api/platform/exams/${id}/export?format=xlsx`}
            >
              Download XLSX
            </a>
            <button onClick={() => window.print()}>Print / save PDF</button>
            <button
              onClick={async () => {
                try {
                  await api(`exams/${id}/sheets`, {});
                  setMessage("Batch appended to the SecureExam sheet.");
                } catch (err) {
                  setMessage((err as Error).message);
                }
              }}
            >
              Sync to Google Sheets
            </button>
          </div>
          <Monitor id={id} policy={e.policy} />
        </section>
      ) : (
        <Accommodations examId={id} />
      )}
    </>
  );
}
function Upload({
  examId,
  attemptId,
  device,
  done,
}: {
  examId: string;
  attemptId?: string;
  device?: string;
  done: (id?: string) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <label className="upload">
        {busy ? "Uploading…" : "Choose a file"}
        <input
          type="file"
          disabled={busy}
          accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            try {
              const form = new FormData();
              form.set("file", file);
              form.set("examId", examId);
              if (attemptId) form.set("attemptId", attemptId);
              const r = await fetch("/api/platform/files", {
                method: "POST",
                body: form,
                headers: device ? { "x-exam-device": device } : {},
              });
              const d = await r.json();
              if (!r.ok) throw new Error(d.error);
              setError("");
              done(d.id);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <ErrorBox message={error} />
    </>
  );
}
export { Upload };
function QuestionBank() {
  const { data: questions, error, refresh } = useData("questions");
  const [prompt, setPrompt] = useState(""),
    [message, setMessage] = useState(""),
    [adding, setAdding] = useState(false),
    [type, setType] = useState("MCQ"),
    [search, setSearch] = useState(""),
    [aiPrompt, setAiPrompt] = useState("");
  return (
    <>
      <Heading
        eyebrow="A LIBRARY OF GOOD QUESTIONS"
        title="Question bank"
        description="Reuse your best ideas. Build a balanced assessment."
      >
        <button className="primary" onClick={() => setAdding(!adding)}>
          <Plus size={17} /> New question
        </button>
      </Heading>
      <ErrorBox message={error || message} />
      {adding && (
        <section className="panel form-panel">
          <form
            onSubmit={async (ev) => {
              ev.preventDefault();
              const f = new FormData(ev.currentTarget);
              try {
                const solution = String(f.get("solution") ?? "");
                await api("questions", {
                  prompt,
                  type,
                  marks: Number(f.get("marks")),
                  options:
                    type === "TRUE_FALSE"
                      ? ["True", "False"]
                      : String(f.get("options") ?? "")
                          .split("\n")
                          .filter(Boolean),
                  solution:
                    type === "MULTI_SELECT"
                      ? solution.split("\n").filter(Boolean)
                      : solution,
                  rubric: f.get("rubric"),
                  topic: f.get("topic"),
                  difficulty: f.get("difficulty"),
                });
                await refresh();
                setAdding(false);
                setPrompt("");
                setMessage("");
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Question type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {[
                    "MCQ",
                    "MULTI_SELECT",
                    "TRUE_FALSE",
                    "FILL_BLANK",
                    "SHORT_ANSWER",
                    "ESSAY",
                    "NUMERIC",
                    "MATCHING",
                    "CODING",
                    "FILE_UPLOAD",
                    "CASE_STUDY",
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Marks
                <input
                  name="marks"
                  type="number"
                  min={1}
                  max={1000}
                  defaultValue={5}
                />
              </label>
              <label>
                Topic
                <input name="topic" />
              </label>
              <label>
                Difficulty
                <select name="difficulty">
                  <option>Easy</option>
                  <option>Medium</option>
                  <option>Hard</option>
                </select>
              </label>
            </div>
            <RichEditor value={prompt} onChange={setPrompt} />
            {["MCQ", "MULTI_SELECT"].includes(type) && (
              <label>
                Choices (one per line)
                <textarea name="options" rows={4} />
              </label>
            )}
            <label>
              Answer key (hidden from students; one per line for multiple
              select)
              <textarea name="solution" rows={2} />
            </label>
            <label>
              Grading rubric (teacher only)
              <textarea name="rubric" rows={2} />
            </label>
            <button className="primary">Save question</button>
          </form>
          <details>
            <summary>Draft with optional AI</summary>
            <p className="muted">
              Review and correct all AI output before saving.
            </p>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Draft a question about binary search trees…"
            />
            <button
              onClick={async () => {
                try {
                  const r = await api("ai", { prompt: aiPrompt });
                  setPrompt(r.text);
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Generate editable draft
            </button>
          </details>
        </section>
      )}
      <div className="list-tools">
        <Search size={18} />
        <input
          aria-label="Search questions"
          placeholder="Search by topic or content…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {questions
        ?.filter((q: any) =>
          (q.prompt + q.topic).toLowerCase().includes(search.toLowerCase()),
        )
        .map((q: any) => (
          <section className="panel question-preview" key={q.id}>
            <div className="eyebrow">
              {q.type.replaceAll("_", " ")} · {q.topic || "GENERAL"} · {q.marks}{" "}
              MARKS
            </div>
            <Markdown text={q.prompt} />
            <details>
              <summary>Answer key & rubric</summary>
              <p>{JSON.stringify(q.solution)}</p>
              <Markdown text={q.rubric} />
            </details>
          </section>
        ))}
      {questions?.length === 0 && (
        <Empty
          title="Start your question library"
          description="Eleven question types, Markdown, code and mathematical notation are supported."
        />
      )}
    </>
  );
}
function Students() {
  const { data: students, error, refresh } = useData("students"),
    { data: courses, refresh: refreshCourses } = useData("courses");
  const [mode, setMode] = useState(""),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState(""),
    [courseCode, setCourseCode] = useState(""),
    [courseSection, setCourseSection] = useState(""),
    [selectedCourseId, setSelectedCourseId] = useState(""),
    [roster, setRoster] = useState<any[] | null>(null),
    [rosterLoading, setRosterLoading] = useState(false),
    [rosterError, setRosterError] = useState(""),
    [enrollEmail, setEnrollEmail] = useState("");
  const selectedCourse = COURSE_CATALOG.find((c) => c.code === courseCode);
  const selectedRosterCourse = courses?.find(
    (course: any) => course.id === selectedCourseId,
  );
  async function toggleCourseRoster(courseId: string) {
    if (courseId === selectedCourseId) {
      setSelectedCourseId("");
      setRoster(null);
      setRosterError("");
      return;
    }
    setSelectedCourseId(courseId);
    setRoster(null);
    setRosterError("");
    setRosterLoading(true);
    try {
      setRoster(await api(`courses/${courseId}/students`));
    } catch (err) {
      setRosterError((err as Error).message);
    } finally {
      setRosterLoading(false);
    }
  }
  async function enrollByEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedCourseId) return;
    setRosterError("");
    try {
      await api(`courses/${selectedCourseId}/enroll`, { email: enrollEmail });
      setEnrollEmail("");
      setMessage("Student enrolled in this course.");
      setRoster(await api(`courses/${selectedCourseId}/students`));
      await refresh();
      await refreshCourses();
    } catch (err) {
      setRosterError((err as Error).message);
    }
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api(
        mode === "course"
          ? "courses"
          : mode === "import"
            ? "students/import"
            : "students",
        f,
      );
      setMode("");
      setCourseCode("");
      setCourseSection("");
      setMessage("Saved successfully.");
      await refresh();
      await refreshCourses();
    } catch (err) {
      setMessage((err as Error).message);
    }
  }
  return (
    <>
      <Heading
        title="Students & courses"
        description="Keep your class organized and give every student the right access."
      >
        <button
          onClick={() => {
            setMode(mode === "course" ? "" : "course");
            setCourseCode("");
            setCourseSection("");
          }}
        >
          New course
        </button>
        <button onClick={() => setMode(mode === "import" ? "" : "import")}>
          Import CSV
        </button>
        <button
          className="primary"
          onClick={() => setMode(mode === "student" ? "" : "student")}
        >
          <Plus size={16} /> Add student
        </button>
      </Heading>
      <ErrorBox message={error} />
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {mode && (
        <section className="panel form-panel">
          <h2>
            {mode === "course"
              ? "New course"
              : mode === "import"
                ? "Import students"
                : "New student"}
          </h2>
          <form onSubmit={submit}>
            {mode === "course" ? (
              <div className="form-grid">
                <label>
                  Subject
                  <select
                    required
                    name="code"
                    value={courseCode}
                    onChange={(event) => {
                      setCourseCode(event.target.value);
                      setCourseSection("");
                    }}
                  >
                    <option value="">Select a subject</option>
                    {COURSE_CATALOG.map((course) => (
                      <option key={course.code} value={course.code}>
                        {course.code} · {course.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Section
                  <select
                    required
                    name="section"
                    value={courseSection}
                    disabled={!selectedCourse}
                    onChange={(event) => setCourseSection(event.target.value)}
                  >
                    <option value="">Select a section</option>
                    {selectedCourse?.sections.map((section) => (
                      <option key={section} value={section}>
                        {section}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  type="hidden"
                  name="name"
                  value={selectedCourse?.name ?? ""}
                />
              </div>
            ) : (
              <>
                {mode === "import" ? (
                  <>
                    <p>
                      CSV headers: email,name,studentId,section,password. Use
                      unique temporary passwords of at least 12 characters.
                      Maximum 250 rows.
                    </p>
                    <label>
                      CSV data
                      <textarea name="csv" rows={6} required />
                    </label>
                  </>
                ) : (
                  <div className="form-grid">
                    <label>
                      Full name
                      <input required name="name" />
                    </label>
                    <label>
                      Student ID
                      <input required name="studentId" />
                    </label>
                    <label>
                      Institutional email
                      <input required name="email" type="email" />
                    </label>
                    <label>
                      Section
                      <input name="section" />
                    </label>
                    <label>
                      Initial password
                      <input
                        required
                        name="password"
                        type="password"
                        minLength={12}
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                )}
                <label>
                  Enroll in course
                  <select required name="courseId">
                    <option value="">Choose course</option>
                    {courses?.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.section}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <button className="primary">
              Save {mode === "course" ? "course" : "students"}
            </button>
          </form>
        </section>
      )}
      <div className="course-list">
        {courses?.map((c: any) => (
          <button
            aria-expanded={selectedCourseId === c.id}
            aria-label={`View roster for ${c.code} section ${c.section || "unspecified"}`}
            className={`course-pill course-pill-button${selectedCourseId === c.id ? " selected" : ""}`}
            key={c.id}
            onClick={() => void toggleCourseRoster(c.id)}
            type="button"
          >
            <GraduationCap size={17} />
            <span>
              <b>{c.code}</b> {c.name} · {c.section || "No section"}
            </span>
            <strong className="course-enrollment-count">
              {c.enrolled_count ?? 0} enrolled
            </strong>
          </button>
        ))}
      </div>
      {selectedCourseId && (
        <section className="panel course-roster" aria-live="polite">
          <div className="course-roster-heading">
            <div>
              <span className="eyebrow">COURSE ROSTER</span>
              <h2>
                {selectedRosterCourse?.code} ·{" "}
                {selectedRosterCourse?.section || "No section"}
              </h2>
              <p>
                {roster?.length ?? selectedRosterCourse?.enrolled_count ?? 0}{" "}
                enrolled students
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggleCourseRoster(selectedCourseId)}
            >
              Close roster
            </button>
          </div>
          <form className="course-enroll-form" onSubmit={enrollByEmail}>
            <label>
              Enroll an existing student by email
              <input
                type="email"
                required
                value={enrollEmail}
                onChange={(event) => setEnrollEmail(event.target.value)}
                placeholder="student@university.edu"
              />
            </label>
            <button className="primary" type="submit">
              <Plus size={16} /> Enroll student
            </button>
          </form>
          <p className="small muted">
            The student must have signed in once with their approved account.
            Their access is limited to this course.
          </p>
          <ErrorBox message={rosterError} />
          {rosterLoading ? (
            <Loading />
          ) : roster?.length ? (
            <div className="table-wrap course-roster-table">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Email</th>
                    <th>Student ID</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((student: any) => (
                    <tr key={student.id}>
                      <td>{student.name}</td>
                      <td>{student.email}</td>
                      <td>{student.student_id}</td>
                      <td>{student.active ? "Active" : "Inactive"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="course-roster-empty">
              No students enrolled yet. Enter a student email above to add the
              first one.
            </p>
          )}
        </section>
      )}
      <div className="list-tools">
        <Search size={18} />
        <input
          aria-label="Search students"
          placeholder="Search name, student ID or section…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Student ID</th>
              <th>Section</th>
              <th>Status</th>
              <th>Last login</th>
              <th>Access</th>
            </tr>
          </thead>
          <tbody>
            {students
              ?.filter((s: any) =>
                (s.name + s.email + s.student_id + s.section)
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((s: any) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <small>{s.email}</small>
                  </td>
                  <td>{s.student_id}</td>
                  <td>{s.section || "—"}</td>
                  <td>
                    <Status value={s.active ? "ACTIVE" : "INACTIVE"} />
                  </td>
                  <td>{time(s.last_login)}</td>
                  <td>
                    <div className="actions">
                      <button
                        onClick={async () => {
                          try {
                            await api("students/" + s.id, {
                              action: s.active ? "deactivate" : "activate",
                            });
                            await refresh();
                          } catch (e) {
                            setMessage((e as Error).message);
                          }
                        }}
                      >
                        {s.active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={async () => {
                          const password = prompt(
                            "New temporary password (12+ characters). Share privately with the student.",
                          );
                          if (!password) return;
                          try {
                            await api("students/" + s.id, {
                              action: "reset",
                              password,
                            });
                            setMessage(
                              "Access reset. Existing sessions revoked.",
                            );
                          } catch (e) {
                            setMessage((e as Error).message);
                          }
                        }}
                      >
                        Reset
                      </button>
                      <select
                        aria-label={"Enroll " + s.name}
                        value=""
                        onChange={async (ev) => {
                          try {
                            await api("students/" + s.id, {
                              action: "enroll",
                              courseId: ev.target.value,
                            });
                            setMessage("Enrollment saved.");
                          } catch (e) {
                            setMessage((e as Error).message);
                          }
                        }}
                      >
                        <option value="">Enroll…</option>
                        {courses?.map((c: any) => (
                          <option value={c.id} key={c.id}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {students?.length === 0 && (
          <Empty
            title="Your class will appear here"
            description="Add individual students or import a CSV roster."
          />
        )}
      </div>
    </>
  );
}
function Classrooms() {
  const { data: rooms, error, refresh } = useData("classrooms");
  const [adding, setAdding] = useState(false),
    [message, setMessage] = useState("");
  return (
    <>
      <Heading
        title="Classrooms"
        description="A physical place for a connected examination."
      >
        <button className="primary" onClick={() => setAdding(!adding)}>
          <Plus size={17} /> Add classroom
        </button>
      </Heading>
      <ErrorBox message={error || message} />
      {adding && (
        <section className="panel form-panel">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await api("classrooms", {
                  ...f,
                  latitude: Number(f.latitude),
                  longitude: Number(f.longitude),
                  radius: Number(f.radius),
                  accuracy: Number(f.accuracy),
                });
                setAdding(false);
                await refresh();
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            <div className="form-grid">
              {[
                ["name", "Classroom name", "text", ""],
                ["building", "Building", "text", ""],
                ["floor", "Floor", "text", ""],
                ["room", "Room number", "text", ""],
                ["latitude", "Latitude", "number", "14.039"],
                ["longitude", "Longitude", "number", "100.615"],
                ["radius", "Allowed radius (m)", "number", "100"],
                [
                  "accuracy",
                  "Maximum location uncertainty (m)",
                  "number",
                  "50",
                ],
              ].map(([key, label, type, value]) => (
                <label key={key}>
                  {label}
                  <input
                    required
                    name={key}
                    type={type}
                    step={type === "number" ? "any" : undefined}
                    defaultValue={value}
                  />
                </label>
              ))}
            </div>
            <p className="muted">
              Verify coordinates on campus. Indoor GPS cannot reliably
              distinguish rooms or floors.
            </p>
            <button className="primary">Save classroom</button>
          </form>
        </section>
      )}
      <div className="exam-grid">
        {rooms?.map((r: any) => (
          <article className="panel room-card" key={r.id}>
            <span className="exam-icon">
              <MapPin size={24} />
            </span>
            <h2>{r.name}</h2>
            <p>
              {r.configuration.building} · Floor {r.configuration.floor || "—"}{" "}
              · Room {r.configuration.room || "—"}
            </p>
            <div className="geofence-visual">
              <span />
              <b>{r.configuration.radius} m</b>
            </div>
            <div className="room-coordinates">
              {r.configuration.latitude}, {r.configuration.longitude}
            </div>
            <p className="small muted">
              Maximum accuracy uncertainty: ±{r.configuration.accuracy} m
            </p>
          </article>
        ))}
      </div>
    </>
  );
}
function MonitorPage() {
  const { data: exams } = useData("exams");
  const [id, setId] = useState("");
  return (
    <>
      <Heading
        eyebrow="STAY CONNECTED"
        title="Live monitoring"
        description="Timely signals, clear context, and room for human judgment."
      />
      <label className="exam-select">
        Examination
        <select value={id} onChange={(e) => setId(e.target.value)}>
          <option value="">Choose an examination</option>
          {exams?.map((e: any) => (
            <option value={e.id} key={e.id}>
              {e.title}
            </option>
          ))}
        </select>
      </label>
      {id ? (
        <Monitor id={id} />
      ) : (
        <Empty
          title="Ready when your class is"
          description="Select an examination to follow check-ins, progress and incidents."
        />
      )}
    </>
  );
}
function Monitor({ id, policy }: { id: string; policy?: any }) {
  const { data, error, refresh } = useData(`exams/${id}/monitor`, 3000);
  const [selected, setSelected] = useState(""),
    [message] = useState(""),
    [sound, setSound] = useState(false),
    [last, setLast] = useState(0);
  useEffect(() => {
    if (!data) return;
    const newest = data.events.find((e: any) => e.severity === "HIGH");
    if (newest && Number(newest.sequence) > last) {
      if (last && sound) {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0.08;
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.15);
        o.onended = () => void ctx.close();
      }
      setLast(Number(newest.sequence));
    }
  }, [data, last, sound]);
  if (!data)
    return (
      <>
        <ErrorBox message={error} />
        <Loading />
      </>
    );
  const students = data.students;
  return (
    <>
      <div className="monitor-strip">
        <span>
          <span className="pulse" /> Live · refreshes every 3 seconds
        </span>
        <label className="check">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
          />{" "}
          Audible alerts
        </label>
        <small>{time(data.serverTime)}</small>
      </div>
      <ErrorBox message={error || message} />
      <div className="stat-grid compact">
        {[
          ["Assigned", students.length],
          [
            "In progress",
            students.filter((s: any) => s.status === "ACTIVE").length,
          ],
          [
            "Submitted",
            students.filter((s: any) => s.status && s.status !== "ACTIVE")
              .length,
          ],
          ["Awaiting entry", students.filter((s: any) => !s.status).length],
        ].map(([label, value]) => (
          <div className="stat" key={label}>
            <strong>{value}</strong>
            <h3>{label}</h3>
          </div>
        ))}
      </div>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Warnings</th>
              <th>Devices</th>
              <th>Location</th>
              <th>Last heartbeat</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s: any) => {
              const seconds = s.last_heartbeat_at
                ? Math.floor(
                    (new Date(data.serverTime).getTime() -
                      new Date(s.last_heartbeat_at).getTime()) /
                      1000,
                  )
                : 0;
              return (
                <tr key={s.user_id}>
                  <td>
                    <strong>{s.name}</strong>
                    <small>{s.student_id}</small>
                  </td>
                  <td>
                    <Status
                      value={
                        s.status === "ACTIVE" && seconds > 30
                          ? "DISCONNECTED"
                          : (s.status ??
                            (s.checkin_at
                              ? "WAITING_APPROVAL"
                              : "NOT_LOGGED_IN"))
                      }
                    />
                  </td>
                  <td>
                    {s.answered ?? 0}/{s.question_order?.length ?? "—"}
                  </td>
                  <td>
                    <b className={s.warnings >= 3 ? "danger-text" : ""}>
                      {s.warnings ?? 0} / {policy?.maxWarnings ?? "—"}
                    </b>
                  </td>
                  <td className="small">
                    Camera {s.device_state?.camera ? "✓" : "—"}
                    <br />
                    Mic {s.device_state?.microphone ? "✓" : "—"} · Fullscreen{" "}
                    {s.device_state?.fullscreen ? "✓" : "—"}
                  </td>
                  <td className="small">
                    {s.location_status?.replaceAll("_", " ") ?? "—"}
                  </td>
                  <td>
                    {s.last_heartbeat_at ? seconds + "s ago" : "—"}
                    {seconds > (policy?.offlineGraceSeconds ?? 120) &&
                      s.status === "ACTIVE" && (
                        <small className="danger-text">Review connection</small>
                      )}
                  </td>
                  <td>
                    {s.id ? (
                      <button onClick={() => setSelected(s.id)}>Inspect</button>
                    ) : s.checkin_at && !s.approved ? (
                      <button
                        onClick={async () => {
                          await api(`exams/${id}/checkin`, {
                            studentId: s.user_id,
                          });
                          await refresh();
                        }}
                      >
                        Allow exam
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selected && (
        <AttemptReview
          id={selected}
          close={() => {
            setSelected("");
            void refresh();
          }}
        />
      )}
      <section className="panel form-panel">
        <div className="notice">
          Graded: {data.stats?.graded ?? 0} · Average:{" "}
          {data.stats?.average?.toFixed(1) ?? "—"} · Median:{" "}
          {data.stats?.median ?? "—"} · Highest: {data.stats?.highest ?? "—"} ·
          Lowest: {data.stats?.lowest ?? "—"} · Total warnings:{" "}
          {data.stats?.warnings ?? 0}
        </div>
        <h2>Event timeline</h2>
        <p className="muted">
          Detection is not a verdict. Review device, network and accommodation
          context.
        </p>
        <div className="timeline">
          {data.events.slice(0, 30).map((e: any) => (
            <div key={e.id}>
              <span
                className={
                  e.severity === "HIGH" ? "activity-dot red" : "activity-dot"
                }
              />
              <time>{time(e.created_at)}</time>
              <div>
                <strong>{e.event_type.replaceAll("_", " ")}</strong>
                <p>
                  {e.name} {e.metadata.reason && "· " + e.metadata.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
function AttemptReview({ id, close }: { id: string; close: () => void }) {
  const { data: a, error, refresh } = useData("attempts/" + id);
  const [message, setMessage] = useState("");
  if (!a) return <ErrorBox message={error} />;
  async function control(action: string, eventId?: string) {
    const note = prompt("Reason / review note (required)");
    if (!note) return;
    const minutes = ["extend", "reopen"].includes(action)
      ? Number(prompt("Minutes", "15"))
      : undefined;
    try {
      await api(`attempts/${id}/control`, { action, note, minutes, eventId });
      await refresh();
      setMessage("Action recorded in the audit trail.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <section className="panel form-panel review-panel">
      <div className="panel-heading">
        <h2>Attempt review</h2>
        <button aria-label="Close attempt review" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <Status value={a.status} />
      <p>
        Score: {a.score ?? "Pending manual grading"} · Warnings: {a.warnings}
      </p>
      <div className="actions">
        {[
          "force-submit",
          "terminate",
          "extend",
          "reopen",
          "reentry",
          "reset-warnings",
          "message",
        ].map((c) => (
          <button key={c} onClick={() => control(c)}>
            {c.replaceAll("-", " ")}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      {message && <p className="notice">{message}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await api(`attempts/${id}/grade`, {
              marks: a.questions
                .filter((q: any) => f.get("mark-" + q.id) !== "")
                .map((q: any) => ({
                  questionId: q.id,
                  mark: Number(f.get("mark-" + q.id)),
                  feedback: String(f.get("feedback-" + q.id) ?? ""),
                })),
              feedback: String(f.get("feedback") ?? ""),
            });
            setMessage(
              "Grades saved. Release results from the examination page when ready.",
            );
            await refresh();
          } catch (err) {
            setMessage((err as Error).message);
          }
        }}
      >
        {a.questions.map((q: any) => {
          const answer = a.answers.find((an: any) => an.question_id === q.id),
            solution = a.solutions?.find((s: any) => s.id === q.id);
          return (
            <div className="question-preview" key={q.id}>
              <Markdown text={q.prompt} />
              <div className="answer-value">
                <b>Student response</b>
                <pre>
                  {typeof answer?.value === "string"
                    ? answer.value
                    : JSON.stringify(answer?.value, null, 2)}
                </pre>
              </div>
              <details>
                <summary>Answer key & rubric</summary>
                <p>{JSON.stringify(solution?.solution)}</p>
                <Markdown text={solution?.rubric ?? ""} />
              </details>
              <div className="form-grid">
                <label>
                  Mark / {q.marks}
                  <input
                    type="number"
                    name={"mark-" + q.id}
                    min={0}
                    max={q.marks}
                    step="any"
                    defaultValue={answer?.mark ?? ""}
                    disabled={a.status === "ACTIVE"}
                  />
                </label>
                <label>
                  Feedback
                  <input
                    name={"feedback-" + q.id}
                    defaultValue={answer?.feedback ?? ""}
                  />
                </label>
              </div>
            </div>
          );
        })}
        <label>
          Overall feedback
          <textarea name="feedback" defaultValue={a.feedback} />
        </label>
        <button className="primary" disabled={a.status === "ACTIVE"}>
          Save grades
        </button>
      </form>
      <h3>Incident evidence</h3>
      {a.events?.map((e: any) => (
        <details key={e.id}>
          <summary>
            {time(e.created_at)} · {e.event_type}
          </summary>
          <pre>{JSON.stringify(e.metadata, null, 2)}</pre>
          <small>Hash: {e.event_hash}</small>
          <div className="actions">
            <button onClick={() => control("review", e.id)}>
              Annotate / mark false positive
            </button>
            {e.event_type === "WARNING_ISSUED" && (
              <button onClick={() => control("waive-warning", e.id)}>
                Waive warning
              </button>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
function Accommodations({ examId }: { examId: string }) {
  const { data } = useData(`exams/${examId}/monitor`);
  const [message, setMessage] = useState("");
  return (
    <section className="panel form-panel">
      <h2>Individual accommodations</h2>
      <p className="muted">
        Set before entry. Use live controls to add time to an active attempt.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await api(`exams/${examId}/accommodations`, {
              studentId: f.get("student"),
              extraMinutes: Number(f.get("minutes")),
              warningExempt: f.has("warnings"),
              cameraExempt: f.has("camera"),
              microphoneExempt: f.has("mic"),
            });
            setMessage("Accommodation saved and audited.");
          } catch (err) {
            setMessage((err as Error).message);
          }
        }}
      >
        <label>
          Student
          <select name="student" required>
            {data?.students.map((s: any) => (
              <option key={s.user_id} value={s.user_id}>
                {s.name} · {s.student_id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Extra minutes
          <input name="minutes" type="number" min={0} defaultValue={0} />
        </label>
        {[
          ["warnings", "Exempt from automatic warnings"],
          ["camera", "Camera exemption"],
          ["mic", "Microphone exemption"],
        ].map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" name={key} />
            {label}
          </label>
        ))}
        <button className="primary">Save accommodation</button>
        <p role="status">{message}</p>
      </form>
    </section>
  );
}
function Audit() {
  const { data, error } = useData("audit", 10000);
  const [search, setSearch] = useState("");
  return (
    <>
      <Heading
        title="Login & attendance audit"
        description="An append-only record for accountable assessment and fair dispute review."
      >
        <a className="button" href="/api/platform/audit?format=csv" download>
          Export CSV
        </a>
        <button onClick={() => window.print()}>Print / PDF</button>
      </Heading>
      <ErrorBox message={error} />
      <div className="list-tools">
        <Search size={18} />
        <input
          aria-label="Search audit"
          placeholder="Search student, event or evidence…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <small>Latest 1,000 events</small>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Server time</th>
              <th>Person</th>
              <th>Event</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {data
              ?.filter((e: any) =>
                JSON.stringify(e).toLowerCase().includes(search.toLowerCase()),
              )
              .map((e: any) => (
                <tr key={e.id}>
                  <td>{time(e.created_at)}</td>
                  <td>
                    {e.name ?? "Unknown account"}
                    <small>{e.student_id ?? e.role}</small>
                  </td>
                  <td>
                    <Status value={e.event_type} />
                  </td>
                  <td>
                    <details>
                      <summary>Inspect details</summary>
                      <pre>{JSON.stringify(e.metadata, null, 2)}</pre>
                      <small>SHA-256: {e.event_hash}</small>
                    </details>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
function SettingsPage({ isAdmin }: { isAdmin: boolean }) {
  const { data: s, error, refresh } = useData("settings");
  const [message, setMessage] = useState("");
  if (!s) return <Loading />;
  return (
    <>
      <Heading
        title="Workspace settings"
        description="Make the platform feel like your institution."
      />
      <ErrorBox message={error} />
      <div className="two-column">
        <section className="panel form-panel">
          <h2>Brand & institution</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              try {
                await api("settings", {
                  ...f,
                  retentionDays: Number(f.retentionDays),
                });
                await refresh();
                setMessage("Settings saved.");
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            <fieldset disabled={!isAdmin}>
              <label>
                Platform name
                <input name="brand" defaultValue={s.brand} />
              </label>
              <label>
                University
                <input name="institution" defaultValue={s.institution} />
              </label>
              <label>
                Timezone
                <input name="timezone" defaultValue={s.timezone} />
              </label>
              <label>
                Accent color
                <input type="color" name="accent" defaultValue={s.accent} />
              </label>
              <label>
                Logo (authorized uploaded file path)
                <input
                  name="logo"
                  defaultValue={s.logo ?? ""}
                  placeholder="/api/platform/files/…"
                />
              </label>
              <label>
                Retention policy (days)
                <input
                  name="retentionDays"
                  type="number"
                  min={7}
                  max={3650}
                  defaultValue={s.retentionDays}
                />
              </label>
              <button className="primary">Save settings</button>
            </fieldset>
            {!isAdmin && (
              <p className="muted">
                Institution settings are managed by an administrator.
              </p>
            )}
            <p role="status">{message}</p>
          </form>
        </section>
        <div>
          <section className="panel form-panel">
            <h2>Integrations</h2>
            {Object.entries(s.integrations).map(([key, v]) => (
              <div className="integration" key={key}>
                <strong>
                  {key === "ai"
                    ? "Ollama · draft assistance"
                    : key === "storage"
                      ? "Vercel Blob · private files"
                      : "Google Sheets · batch exports"}
                </strong>
                <Status value={v ? "CONFIGURED" : "NOT_CONFIGURED"} />
              </div>
            ))}
            <p className="small muted">
              Secrets are configured in the deployment environment. No API keys
              are stored in browser settings.
            </p>
          </section>
          <section className="panel form-panel">
            <h2>Privacy & account security</h2>
            <p>
              Camera and microphone streams stay on the device. Browser signals
              and location checkpoints are retained as evidence for instructor
              review.
            </p>
            <p className="muted">
              Retention is an institutional policy. Immutable evidence requires
              an approved archival process; this application never silently
              deletes dispute records.
            </p>
            <button
              onClick={async () => {
                if (confirm("Sign out every device, including this one?")) {
                  await api("me", {});
                  await signOut({ callbackUrl: "/login" });
                }
              }}
            >
              Sign out all devices
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
function StudentHome({ user }: { user: Actor }) {
  const { data: exams, error } = useData("exams", 10000);
  return (
    <>
      <Heading
        eyebrow="YOUR STUDENT WORKSPACE"
        title={"Ready when you are, " + user.name.split(" ")[0] + "."}
        description="Find your examination, check your equipment, and take a moment to prepare."
      />
      <div className="notice">
        <ShieldCheck size={20} /> Keep your university account private. Read the
        monitoring notice before each examination.
      </div>
      <ErrorBox message={error} />
      <div className="exam-grid">
        {exams?.map((e: any) => (
          <article className="exam-card" key={e.id}>
            <div>
              <span className="course-tag">{e.course_code}</span>
              <Status value={e.attempt_status ?? e.status} />
            </div>
            <h2>{e.title}</h2>
            <p>
              {time(e.starts_at)} · {e.duration_minutes} minutes
            </p>
            {e.score !== null && (
              <p>
                <strong>Your score: {e.score}</strong>
              </p>
            )}
            <Markdown text={e.instructions} />
            <Link className="button primary" href={"/exam/" + e.id}>
              {e.attempt_status === "ACTIVE"
                ? "Resume examination"
                : e.attempt_status
                  ? "View submission"
                  : "Security check"}{" "}
              <ArrowUpRight size={16} />
            </Link>
          </article>
        ))}
      </div>
      {exams?.length === 0 && (
        <Empty
          title="No examinations assigned yet"
          description="Your instructor will publish your assessments here."
        />
      )}
    </>
  );
}
