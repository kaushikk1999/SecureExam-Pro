import { beforeAll, afterAll, afterEach, it, expect, vi } from "vitest";
import { readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
const auth = vi.hoisted(() => ({ session: null as any }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));
process.env.DATABASE_PROVIDER = "pglite";
process.env.PGLITE_PATH = "./.data/growth-test-" + randomUUID();
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.STUDENT_LOGIN_EMAILS =
  "student@gmail.com,other@gmail.com,first.login@bumail.net";
process.env.AUTH_SECRET = "test-auth-secret-long-enough-for-course-invite";
const { db, query } = await import("../src/lib/db");
const { GET, POST } = await import("../src/app/api/platform/[...path]/route");
const { resolveGoogleIdentity, resolveUniversityIdentity } =
  await import("../src/lib/sso");
const { ensureDefaultCoursesForUser } =
  await import("../src/lib/course-provisioning");
const admin = randomUUID(),
  teacher = randomUUID(),
  foreign = randomUUID(),
  student = randomUUID(),
  other = randomUUID(),
  course = randomUUID(),
  exam = randomUUID(),
  question = randomUUID(),
  attempt = randomUUID(),
  event = randomUUID();
let appeal = "";
function login(id: string | null) {
  auth.session = id ? { user: { id, version: 0 } } : null;
}
async function request(path: string, data?: any) {
  const req = new Request("http://localhost:3000/api/platform/growth/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return (data === undefined ? GET : POST)(req, {
    params: Promise.resolve({ path: ["growth", ...path.split("/")] }),
  });
}
async function platformRequest(path: string, data?: any) {
  const parts = path.split("/");
  const req = new Request("http://localhost:3000/api/platform/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return (data === undefined ? GET : POST)(req, {
    params: Promise.resolve({ path: parts }),
  });
}
async function ok(path: string, data?: any) {
  const r = await request(path, data);
  const b = await r.json();
  expect(r.status, JSON.stringify(b)).toBe(200);
  return b;
}
beforeAll(async () => {
  for (const file of (await readdir("migrations")).sort())
    for (const s of (await readFile("migrations/" + file, "utf8"))
      .split(/;\s*\n/)
      .filter((s) => s.trim()))
      await db.execute(sql.raw(s));
  for (const [id, role, email] of [
    [admin, "ADMIN", "admin@test.local"],
    [teacher, "TEACHER", "teacher@test.local"],
    [foreign, "TEACHER", "foreign@test.local"],
    [student, "STUDENT", "student@gmail.com"],
    [other, "STUDENT", "other@gmail.com"],
  ])
    await db.execute(
      sql`INSERT INTO users(id,email,name,password_hash,role) VALUES(${id},${email},${email},'unused',${role})`,
    );
  await db.execute(
    sql`INSERT INTO courses(id,teacher_id,code,name) VALUES(${course},${teacher},'CS1','Computer Science')`,
  );
  await db.execute(
    sql`INSERT INTO enrollments(course_id,user_id) VALUES(${course},${student})`,
  );
  await db.execute(
    sql`INSERT INTO questions(id,teacher_id,type,prompt,marks,solution,topic) VALUES(${question},${teacher},'MCQ','Sample',10,'"A"','Algorithms')`,
  );
  await db.execute(
    sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${exam},${course},'Midterm','PUBLISHED',now()-interval '1 hour',now()+interval '1 hour',60,'{}','secret')`,
  );
  await db.execute(
    sql`INSERT INTO exam_questions(exam_id,question_id,position) VALUES(${exam},${question},0)`,
  );
  await db.execute(
    sql`INSERT INTO attempts(id,exam_id,user_id,device_session_id,status,question_order,deadline,score,feedback,submitted_at) VALUES(${attempt},${exam},${student},${randomUUID()},'SUBMITTED',${JSON.stringify([question])}::jsonb,now(),5,'Private feedback',now())`,
  );
  await db.execute(
    sql`INSERT INTO answers(attempt_id,question_id,value,mark,feedback) VALUES(${attempt},${question},'"B"',5,'Study graphs')`,
  );
  const { record } = await import("../src/lib/audit");
  await record({
    userId: student,
    examId: exam,
    attemptId: attempt,
    type: "WARNING_ISSUED",
    severity: "HIGH",
    metadata: { private: "instructor-only" },
  });
  const [ev] = await query(
    sql`SELECT id FROM audit_events WHERE event_type='WARNING_ISSUED'`,
  );
  // Keep the generated audit hash valid; use the real event ID below.
  Object.assign(ids, { event: ev.id });
  await db.execute(
    sql`INSERT INTO warning_evidence_archives(attempt_id,exam_id,folder_id,report_id,evidence_count) VALUES(${attempt},${exam},'drive-student-folder','drive-report',1)`,
  );
  await db.execute(
    sql`INSERT INTO checkins(exam_id,user_id) VALUES(${exam},${student})`,
  );
});
const ids = { event };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await (db as any).$client.close();
  await rm(process.env.PGLITE_PATH!, { recursive: true, force: true });
});
it("requires a session and enforces role boundaries", async () => {
  login(null);
  expect((await request("practice")).status).toBe(401);
  login(student);
  for (const path of ["actions", "submissions", "integrations"])
    expect((await request(path)).status).toBe(403);
  login(teacher);
  expect((await request("integrations")).status).toBe(403);
  expect((await request("learning")).status).toBe(403);
});
it("lists submitted papers by student only for the teacher's courses", async () => {
  login(teacher);
  const rows = await ok("submissions");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    attempt_id: attempt,
    exam_id: exam,
    exam_title: "Midterm",
    course_code: "CS1",
    course_name: "Computer Science",
    student_name: "student@gmail.com",
    email: "student@gmail.com",
    attempt_status: "SUBMITTED",
    answered: 1,
    question_count: 1,
    has_document: false,
  });
  login(foreign);
  expect(await ok("submissions")).toEqual([]);
  login(admin);
  expect(await ok("submissions")).toHaveLength(1);
});
it("exports every submitted attempt with its ordered questions and answers", async () => {
  login(teacher);
  const rows = await ok(`submissions/${exam}`);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    attempt_id: attempt,
    exam_title: "Midterm",
    student_name: "student@gmail.com",
    student_id: null,
    email: "student@gmail.com",
    questions: [
      {
        id: question,
        type: "MCQ",
        prompt: "Sample",
        value: "B",
        feedback: "Study graphs",
      },
    ],
  });
  expect(Number(rows[0].questions[0].marks)).toBe(10);
  expect(Number(rows[0].questions[0].mark)).toBe(5);
  login(foreign);
  expect((await request(`submissions/${exam}`)).status).toBe(403);
});
it("isolates practice saves and rejects old versions without touching official attempts", async () => {
  login(student);
  await ok("practice", {
    answer: { choice: "4", reflection: "Practice" },
    version: 1,
  });
  expect((await ok("practice")).saved.answer.reflection).toBe("Practice");
  expect(
    (
      await request("practice", {
        answer: { choice: "5", reflection: "Old" },
        version: 1,
      })
    ).status,
  ).toBe(409);
  login(other);
  expect((await ok("practice")).saved).toBeNull();
  expect((await query(sql`SELECT count(*)::int AS n FROM attempts`))[0].n).toBe(
    1,
  );
  expect(
    (await query(sql`SELECT value FROM answers WHERE attempt_id=${attempt}`))[0]
      .value,
  ).toBe("B");
});
it("withholds unreleased feedback and reports only the current student after release", async () => {
  login(student);
  expect((await ok("learning")).attempts).toEqual([]);
  await db.execute(
    sql`UPDATE exams SET results_released=true WHERE id=${exam}`,
  );
  const r = await ok("learning");
  expect(r.attempts[0].feedback).toBe("Private feedback");
  expect(r.topics[0]).toMatchObject({
    topic: "Algorithms",
    earned: 5,
    possible: 10,
    count: 1,
  });
  login(other);
  expect((await ok("learning")).responses).toEqual([]);
});
it("scopes the action queue and durably reviews incidents", async () => {
  login(foreign);
  expect((await ok("actions")).incidents).toEqual([]);
  expect(
    (
      await request("actions", {
        eventId: ids.event,
        note: "Foreign review denied",
      })
    ).status,
  ).toBe(403);
  login(teacher);
  let r = await ok("actions");
  expect(r.pending).toHaveLength(1);
  expect(r.incidents).toHaveLength(1);
  expect(r.incidents[0]).toMatchObject({
    reviewed: false,
    drive_folder_id: "drive-student-folder",
    drive_report_id: "drive-report",
  });
  await ok("actions", {
    eventId: ids.event,
    note: "Reviewed this warning in context.",
  });
  r = await ok("actions");
  expect(r.incidents).toHaveLength(0);
  expect(
    (
      await request("actions", {
        eventId: ids.event,
        note: "Duplicate review is rejected.",
      })
    ).status,
  ).toBe(409);
});
it("lets students appeal only their own warning and hides private event metadata", async () => {
  login(other);
  expect(
    (
      await request("appeals", {
        eventId: ids.event,
        message: "This is someone else’s event.",
      })
    ).status,
  ).toBe(404);
  login(student);
  const r = await ok("appeals");
  expect(r.events).toHaveLength(1);
  expect(JSON.stringify(r)).not.toContain("instructor-only");
  appeal = (
    await ok("appeals", {
      eventId: ids.event,
      message: "The browser lost focus because of a device error.",
    })
  ).id;
  expect(
    (
      await request("appeals", {
        eventId: ids.event,
        message: "Duplicate case is rejected.",
      })
    ).status,
  ).toBe(409);
  login(foreign);
  expect((await ok("appeals")).cases).toHaveLength(0);
  expect(
    (
      await request("appeals/" + appeal + "/update", {
        version: 1,
        status: "UPHELD",
        message: "Not authorized to review.",
      })
    ).status,
  ).toBe(403);
});
it("rejects concurrent stale decisions and permits one student reopening", async () => {
  login(teacher);
  await ok("appeals/" + appeal + "/update", {
    version: 1,
    status: "UNDER_REVIEW",
    message: "Reviewing the connection logs.",
  });
  expect(
    (
      await request("appeals/" + appeal + "/update", {
        version: 1,
        status: "DISMISSED",
        message: "Stale review cannot overwrite.",
      })
    ).status,
  ).toBe(409);
  await ok("appeals/" + appeal + "/update", {
    version: 2,
    status: "DISMISSED",
    message: "Additional information is needed.",
  });
  login(student);
  await ok("appeals/" + appeal + "/update", {
    version: 3,
    status: "OPEN",
    message: "Here is additional information about the outage.",
  });
  login(teacher);
  await ok("appeals/" + appeal + "/update", {
    version: 4,
    status: "UPHELD",
    message: "The additional explanation is accepted.",
  });
  login(student);
  expect(
    (
      await request("appeals/" + appeal + "/update", {
        version: 5,
        status: "OPEN",
        message: "Cannot reopen for a second time.",
      })
    ).status,
  ).toBe(409);
  const r = await ok("appeals");
  expect(r.messages).toHaveLength(5);
  expect(r.cases[0].status).toBe("UPHELD");
  expect(
    Number(
      (await query(sql`SELECT score FROM attempts WHERE id=${attempt}`))[0]
        .score,
    ),
  ).toBe(5);
});
it("binds existing Google accounts and provisions verified university accounts safely", async () => {
  const p = {
    iss: "https://accounts.google.com",
    sub: "google-student",
    email: "student@gmail.com",
    email_verified: true,
  };
  expect(
    await resolveGoogleIdentity({ ...p, email_verified: false }),
  ).toBeNull();
  expect(
    await resolveGoogleIdentity({ ...p, email: "new@gmail.com" }),
  ).toBeNull();
  expect((await resolveGoogleIdentity(p))?.id).toBe(student);
  expect(
    await resolveGoogleIdentity({ ...p, sub: "different-subject" }),
  ).toBeNull();
  expect((await resolveGoogleIdentity(p))?.role).toBe("STUDENT");
  await db.execute(sql`UPDATE users SET active=false WHERE id=${student}`);
  expect(await resolveGoogleIdentity(p)).toBeNull();
  await db.execute(sql`UPDATE users SET active=true WHERE id=${student}`);
  await db.execute(
    sql`UPDATE users SET mfa_secret='configured' WHERE id=${student}`,
  );
  expect(await resolveGoogleIdentity(p)).toBeNull();
  await db.execute(sql`UPDATE users SET mfa_secret=NULL WHERE id=${student}`);

  vi.stubEnv("GOOGLE_AUTO_PROVISION_DOMAINS", "");
  vi.stubEnv("GOOGLE_TEACHER_EMAILS", "");
  const defaultBuStudent = await resolveGoogleIdentity({
    iss: "https://accounts.google.com",
    sub: "google-default-bu-student",
    email: "first.login@bumail.net",
    email_verified: true,
    hd: "bumail.net",
  });
  expect(defaultBuStudent?.role).toBe("STUDENT");

  const previousVercel = process.env.VERCEL;
  const previousStudentAllowlist = process.env.STUDENT_LOGIN_EMAILS;
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("STUDENT_LOGIN_EMAILS", "kaushikka99@gmail.com");
  const productionBuStudent = await resolveGoogleIdentity({
    iss: "https://accounts.google.com",
    sub: "google-production-bu-student",
    email: "siraphob.nimn@bumail.net",
    email_verified: true,
    hd: "bumail.net",
  });
  expect(productionBuStudent?.role).toBe("STUDENT");
  vi.stubEnv("VERCEL", previousVercel ?? "");
  vi.stubEnv("STUDENT_LOGIN_EMAILS", previousStudentAllowlist ?? "");

  expect(
    await resolveGoogleIdentity({
      iss: "https://accounts.google.com",
      sub: "google-incomplete-bu-domain",
      email: "student@bu.ac",
      email_verified: true,
      hd: "bu.ac",
    }),
  ).toBeNull();

  vi.stubEnv("STUDENT_LOGIN_EMAILS", "kaushikds1999@gmail.com");
  const testStudent = await resolveGoogleIdentity({
    iss: "https://accounts.google.com",
    sub: "google-exact-test-student",
    email: "kaushikds1999@gmail.com",
    email_verified: true,
    name: "Demo Student",
  });
  expect(testStudent?.role).toBe("STUDENT");
  expect(
    await resolveGoogleIdentity({
      iss: "https://accounts.google.com",
      sub: "google-unlisted-test-student",
      email: "another.student@gmail.com",
      email_verified: true,
    }),
  ).toBeNull();
  expect(
    await resolveGoogleIdentity({
      iss: "https://accounts.google.com",
      sub: "google-default-bu-student",
      email: "first.login@bumail.net",
      email_verified: true,
      hd: "bumail.net",
    }),
  ).toBeNull();

  vi.stubEnv("GOOGLE_AUTO_PROVISION_DOMAINS", "bu.ac.th");
  vi.stubEnv("GOOGLE_TEACHER_EMAILS", "kaushik.k@bu.ac.th");
  const buTeacher = await resolveGoogleIdentity({
    iss: "https://accounts.google.com",
    sub: "google-bu-teacher",
    email: "kaushik.k@bu.ac.th",
    email_verified: true,
    hd: "bu.ac.th",
    name: "Kaushik K",
  });
  expect(buTeacher?.role).toBe("TEACHER");
  expect(buTeacher?.name).toBe("Kaushik K");

  const buStudent = await resolveGoogleIdentity({
    iss: "https://accounts.google.com",
    sub: "google-bu-student",
    email: "new.student@bu.ac.th",
    email_verified: true,
    hd: "bu.ac.th",
  });
  expect(buStudent).toBeNull();

  expect(
    await resolveGoogleIdentity({
      iss: "https://accounts.google.com",
      sub: "google-forged-domain",
      email: "fake@bu.ac.th",
      email_verified: true,
      hd: "attacker.example",
    }),
  ).toBeNull();
  expect(
    await resolveGoogleIdentity({
      iss: "https://accounts.google.com",
      sub: "google-unlisted-domain",
      email: "new@other.ac.th",
      email_verified: true,
      hd: "other.ac.th",
    }),
  ).toBeNull();

  vi.stubEnv("STUDENT_LOGIN_EMAILS", "already.student@bu.ac.th");
  const preprovisioned = randomUUID();
  await db.execute(
    sql`INSERT INTO users(id,email,name,password_hash,role) VALUES(${preprovisioned},'already.student@bu.ac.th','Existing Student','unused','STUDENT')`,
  );
  const linkedExisting = await resolveGoogleIdentity({
    iss: "https://accounts.google.com",
    sub: "google-existing-student",
    email: "already.student@bu.ac.th",
    email_verified: true,
    hd: "bu.ac.th",
  });
  expect(linkedExisting?.id).toBe(preprovisioned);
  expect(linkedExisting?.role).toBe("STUDENT");
});
it("requires explicit issuer/subject mappings for custom OIDC", async () => {
  process.env.SSO_ISSUER = "https://identity.example.test";
  const p = {
    iss: process.env.SSO_ISSUER,
    sub: "university-teacher",
    email: "teacher@test.local",
  };
  expect(await resolveUniversityIdentity(p)).toBeNull();
  await db.execute(
    sql`INSERT INTO sso_identities(issuer,subject,user_id) VALUES(${p.iss},${p.sub},${teacher})`,
  );
  expect((await resolveUniversityIdentity(p))?.id).toBe(teacher);
  process.env.REQUIRE_TEACHER_MFA = "true";
  expect(await resolveUniversityIdentity(p)).toBeNull();
  expect((await resolveUniversityIdentity({ ...p, amr: ["mfa"] }))?.id).toBe(
    teacher,
  );
  delete process.env.REQUIRE_TEACHER_MFA;
});
it("creates a course-specific enrollment QR invite and enrolls its student", async () => {
  vi.stubEnv("STUDENT_LOGIN_EMAILS", "student@gmail.com,other@gmail.com");
  login(teacher);
  const inviteResponse = await platformRequest(
    `courses/${course}/enrollment-invite`,
  );
  const invite = await inviteResponse.json();
  expect(inviteResponse.status).toBe(200);
  expect(invite.token).toMatch(/^[a-f0-9]{64}$/);

  login(other);
  const invalid = await platformRequest(`courses/${course}/self-enroll`, {
    token: "0".repeat(64),
  });
  expect(invalid.status).toBe(403);
  const joined = await platformRequest(`courses/${course}/self-enroll`, {
    token: invite.token,
  });
  expect(joined.status).toBe(200);
  expect(await joined.json()).toMatchObject({ ok: true, enrolled: true });
  const [enrollment] = await query(
    sql`SELECT eligible FROM enrollments WHERE course_id=${course} AND user_id=${other}`,
  );
  expect(enrollment?.eligible).toBe(true);
  const repeated = await platformRequest(`courses/${course}/self-enroll`, {
    token: invite.token,
  });
  expect(await repeated.json()).toMatchObject({ ok: true, enrolled: false });
});
it("provisions the configured teacher's default course sections once", async () => {
  vi.stubEnv("DEFAULT_COURSE_OWNER_EMAIL", "teacher@test.local");
  const owner = { id: teacher, email: "teacher@test.local", role: "TEACHER" };
  await ensureDefaultCoursesForUser(owner);
  await ensureDefaultCoursesForUser(owner);
  const courses = await query(
    sql`SELECT code,name,section FROM courses WHERE teacher_id=${teacher} AND code IN ('IBA214','IBA360','IBE102') ORDER BY code,section`,
  );
  expect(courses).toEqual([
    { code: "IBA214", name: "Technology for Business", section: "256C" },
    { code: "IBA214", name: "Technology for Business", section: "256D" },
    {
      code: "IBA360",
      name: "Data Structures and Algorithms",
      section: "356A",
    },
    {
      code: "IBE102",
      name: "Digital Business Technology",
      section: "153A",
    },
  ]);

  await ensureDefaultCoursesForUser({
    id: student,
    email: "student@gmail.com",
    role: "STUDENT",
  });
  expect(
    await query(sql`SELECT id FROM courses WHERE teacher_id=${student}`),
  ).toHaveLength(0);
});
it("does not expose removed LMS synchronization routes", async () => {
  login(admin);
  expect(
    (
      await request("integrations/preview", {
        kind: "ROSTER",
        targetId: course,
      })
    ).status,
  ).toBe(404);
});

it("shows only unexpired disconnected attempts in the instructor support queue", async () => {
  await db.execute(
    sql`UPDATE attempts SET status='ACTIVE',deadline=now()+interval '10 minutes',last_heartbeat_at=now()-interval '2 minutes' WHERE id=${attempt}`,
  );
  login(teacher);
  expect((await ok("actions")).disconnected).toHaveLength(1);
  login(foreign);
  expect((await ok("actions")).disconnected).toHaveLength(0);
  await db.execute(
    sql`UPDATE attempts SET deadline=now()-interval '1 second' WHERE id=${attempt}`,
  );
  login(teacher);
  expect((await ok("actions")).disconnected).toHaveLength(0);
  await db.execute(
    sql`UPDATE attempts SET status='SUBMITTED' WHERE id=${attempt}`,
  );
});

it("tracks new warning notifications per teacher and clears them when seen", async () => {
  login(teacher);
  // First access seeds the read cursor so historical warnings are not treated
  // as newly arrived notifications.
  expect(await ok("notifications")).toEqual({ unreadWarnings: 0 });
  expect(await ok("notifications", {})).toMatchObject({
    ok: true,
    unreadWarnings: 0,
  });
  const { record } = await import("../src/lib/audit");
  await record({
    userId: student,
    examId: exam,
    attemptId: attempt,
    type: "WARNING_ISSUED",
    severity: "HIGH",
    metadata: { reason: "WINDOW_BLUR" },
  });
  expect(await ok("notifications")).toEqual({ unreadWarnings: 1 });
  expect(await ok("notifications", {})).toMatchObject({
    ok: true,
    unreadWarnings: 0,
  });
  expect(await ok("notifications")).toEqual({ unreadWarnings: 0 });
  login(foreign);
  expect(await ok("notifications")).toEqual({ unreadWarnings: 0 });
  login(student);
  expect(await ok("notifications")).toEqual({ unreadWarnings: 0 });
});
