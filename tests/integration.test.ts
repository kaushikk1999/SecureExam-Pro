import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { searchablePdf } from "./helpers/searchable-pdf";
const auth = vi.hoisted(() => ({ session: null as any }));
const requestSession = new AsyncLocalStorage<string>();
const blob = vi.hoisted(() => ({
  put: vi.fn(async () => ({ url: "https://blob.test/private-paper" })),
  get: vi.fn(),
  del: vi.fn(async () => undefined),
}));
vi.mock("next-auth", () => ({
  getServerSession: async () => {
    const id = requestSession.getStore();
    return id ? { user: { id, version: 0 } } : auth.session;
  },
}));
vi.mock("@vercel/blob", () => blob);
process.env.DATABASE_PROVIDER = "pglite";
process.env.PGLITE_PATH = "./.data/test-" + randomUUID();
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
const { db, query } = await import("../src/lib/db");
const { GET, POST, PATCH, DELETE } =
  await import("../src/app/api/platform/[...path]/route");
const { resolveGoogleIdentity } = await import("../src/lib/sso");
const { authOptions } = await import("../src/lib/auth");
const { auditHash, policySchema, createCourseEnrollmentInvite } =
  await import("../src/lib/domain");
const teacher = randomUUID(),
  student = randomUUID(),
  other = randomUUID(),
  course = randomUUID(),
  question = randomUUID(),
  exam = randomUUID(),
  device = randomUUID();
process.env.STUDENT_LOGIN_EMAILS = `${student}@test.local,${other}@test.local`;
let attempt = "";
function login(id: string | null) {
  auth.session = id ? { user: { id, version: 0 } } : null;
}
async function request(
  path: string,
  data?: any,
  extra: Record<string, string> = {},
  method?: string,
) {
  const request = new Request("http://localhost:3000/api/platform/" + path, {
    method: method ?? (data === undefined ? "GET" : "POST"),
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36",
      "x-exam-device": device,
      ...extra,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const handler = method === "PATCH" ? PATCH : data === undefined ? GET : POST;
  return handler(request, {
    params: Promise.resolve({ path: path.split("/") }),
  });
}
function requestAs(
  userId: string,
  path: string,
  data?: any,
  extra: Record<string, string> = {},
  method?: string,
) {
  return requestSession.run(userId, () => request(path, data, extra, method));
}
async function deleteRequest(path: string, extra: Record<string, string> = {}) {
  const request = new Request("http://localhost:3000/api/platform/" + path, {
    method: "DELETE",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36",
      "x-exam-device": device,
      ...extra,
    },
  });
  return DELETE(request, {
    params: Promise.resolve({ path: path.split("/") }),
  });
}
async function uploadRequest(
  path: string,
  form: FormData,
  extra: Record<string, string> = {},
) {
  const request = new Request("http://localhost:3000/api/platform/" + path, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "x-exam-device": device,
      ...extra,
    },
    body: form,
  });
  return POST(request, { params: Promise.resolve({ path: path.split("/") }) });
}
const start = {
  deviceSessionId: device,
  deviceClass: "laptop",
  accepted: true,
  checks: {
    camera: false,
    microphone: false,
    screen: true,
    fullscreen: false,
  },
  code: "",
};
beforeAll(async () => {
  for (const file of (await readdir("migrations")).sort())
    for (const statement of (await readFile("migrations/" + file, "utf8"))
      .split(/;\s*\n/)
      .filter((s) => s.trim()))
      await db.execute(sql.raw(statement));
  for (const [id, role] of [
    [teacher, "TEACHER"],
    [student, "STUDENT"],
    [other, "STUDENT"],
  ])
    await db.execute(
      sql`INSERT INTO users(id,email,name,password_hash,role,student_id) VALUES(${id},${id + "@test.local"},'Test','unused',${role},${role === "STUDENT" ? id + "-ID" : null})`,
    );
  await db.execute(
    sql`INSERT INTO exam_devices(id,user_id,session_version) VALUES(${device},${student},0)`,
  );
  await db.execute(
    sql`INSERT INTO courses(id,teacher_id,code,name) VALUES(${course},${teacher},'TST','Testing')`,
  );
  for (const id of [student, other])
    await db.execute(
      sql`INSERT INTO enrollments(course_id,user_id) VALUES(${course},${id})`,
    );
  await db.execute(
    sql`INSERT INTO questions(id,teacher_id,type,prompt,marks,solution,options) VALUES(${question},${teacher},'MCQ','Question',5,'"SECRET_KEY"','["SECRET_KEY","B"]')`,
  );
  await db.execute(
    sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${exam},${course},'Integration','PUBLISHED',now()-interval '1 hour',now()+interval '2 hours',60,${JSON.stringify(policySchema.parse({ camera: false, microphone: false, location: false, fullscreen: false, classroomCode: false }))}::jsonb,'secret')`,
  );
  await db.execute(
    sql`INSERT INTO exam_questions(exam_id,question_id,position) VALUES(${exam},${question},0)`,
  );
});
afterAll(async () => {
  await (db as any).$client.close();
  await rm(process.env.PGLITE_PATH!, { recursive: true, force: true });
});
describe("server authorization and exam lifecycle", () => {
  it("handles 100 simultaneous QR enrollments and exam starts", async () => {
    const previousAllowlist = process.env.STUDENT_LOGIN_EMAILS;
    const previousSecret = process.env.AUTH_SECRET;
    const subjects = Array.from({ length: 100 }, () => randomUUID());
    const emails = subjects.map((id) => `${id}@bumail.net`);
    let users: string[] = [];
    const loadCourse = randomUUID();
    const loadExam = randomUUID();
    process.env.STUDENT_LOGIN_EMAILS = [previousAllowlist, ...emails]
      .filter(Boolean)
      .join(",");
    process.env.AUTH_SECRET = "integration-test-course-invite-secret";

    try {
      const accounts = await Promise.all(
        subjects.map((subject, index) =>
          resolveGoogleIdentity({
            iss: "https://accounts.google.com",
            sub: subject,
            email: emails[index],
            email_verified: true,
            hd: "bumail.net",
            name: `Load test student ${index + 1}`,
          }),
        ),
      );
      expect(accounts.every(Boolean)).toBe(true);
      users = accounts.map((account) => account!.id);
      const credentialsProvider = authOptions.providers.find(
        (provider: any) => provider.id === "credentials",
      ) as any;
      const passwordLogin = await credentialsProvider.authorize(
        { email: emails[0], password: "not-a-google-password" },
        { headers: { "user-agent": "capacity-test" } },
      );
      expect(passwordLogin).toBeNull();
      const profiles = await Promise.all(
        users.map((id, index) =>
          requestAs(
            id,
            "me/profile",
            { studentId: `LOAD-${index}` },
            {},
            "PATCH",
          ),
        ),
      );
      expect(profiles.map((response) => response.status)).toEqual(
        Array(100).fill(200),
      );
      const [sourceExam] = await query(
        sql`SELECT policy FROM exams WHERE id=${exam}`,
      );
      await db.execute(
        sql`INSERT INTO courses(id,teacher_id,code,name) VALUES(${loadCourse},${teacher},'LOAD','Capacity test')`,
      );
      await db.execute(
        sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${loadExam},${loadCourse},'100-student capacity test','PUBLISHED',now()-interval '1 hour',now()+interval '2 hours',60,${JSON.stringify(sourceExam.policy)}::jsonb,'load-test-secret')`,
      );
      await db.execute(
        sql`INSERT INTO exam_questions(exam_id,question_id,position) VALUES(${loadExam},${question},0)`,
      );
      const token = createCourseEnrollmentInvite(
        process.env.AUTH_SECRET,
        loadCourse,
      );
      const enrollments = await Promise.all(
        users.map((id) =>
          requestAs(id, `courses/${loadCourse}/self-enroll`, { token }),
        ),
      );
      expect(enrollments.map((response) => response.status)).toEqual(
        Array(100).fill(200),
      );
      const enrollmentCount = await query(
        sql`SELECT count(*)::int AS count FROM enrollments WHERE course_id=${loadCourse}`,
      );
      expect(enrollmentCount[0].count).toBe(100);

      const devices = users.map(() => randomUUID());
      for (let i = 0; i < users.length; i++) {
        await db.execute(
          sql`INSERT INTO exam_devices(id,user_id,session_version) VALUES(${devices[i]},${users[i]},0)`,
        );
      }
      const starts = await Promise.all(
        users.map((id, index) =>
          requestAs(id, `exams/${loadExam}/start`, {
            ...start,
            deviceSessionId: devices[index],
          }),
        ),
      );
      expect(starts.map((response) => response.status)).toEqual(
        Array(100).fill(200),
      );
      const activeAttempts = await query(
        sql`SELECT count(*)::int AS count FROM attempts WHERE exam_id=${loadExam} AND status='ACTIVE'`,
      );
      expect(activeAttempts[0].count).toBe(100);
      const attemptIds = await Promise.all(
        starts.map(async (response) => (await response.json()).id),
      );

      const reads = await Promise.all(
        users.map((id, index) =>
          requestAs(id, `attempts/${attemptIds[index]}`, undefined, {
            "x-exam-device": devices[index],
          }),
        ),
      );
      expect(reads.map((response) => response.status)).toEqual(
        Array(100).fill(200),
      );
      const saves = await Promise.all(
        users.map((id, index) =>
          requestAs(
            id,
            `attempts/${attemptIds[index]}/sync`,
            {
              answers: [
                {
                  questionId: question,
                  value: `Answer ${index + 1}`,
                  version: 1,
                },
              ],
            },
            { "x-exam-device": devices[index] },
          ),
        ),
      );
      expect(saves.map((response) => response.status)).toEqual(
        Array(100).fill(200),
      );
      const savedAnswers = await query(
        sql`SELECT count(*)::int AS count FROM answers an JOIN attempts a ON a.id=an.attempt_id WHERE a.exam_id=${loadExam}`,
      );
      expect(savedAnswers[0].count).toBe(100);
    } finally {
      if (previousAllowlist === undefined)
        delete process.env.STUDENT_LOGIN_EMAILS;
      else process.env.STUDENT_LOGIN_EMAILS = previousAllowlist;
      if (previousSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previousSecret;
    }
  }, 30000);
  it("rejects unauthenticated requests", async () => {
    login(null);
    expect((await request("exams")).status).toBe(401);
  });
  it("rejects student access to teacher APIs", async () => {
    login(student);
    for (const path of [
      "students",
      "questions",
      "audit",
      "classrooms",
      "courses",
    ])
      expect((await request(path)).status).toBe(403);
  });
  it("allows an authorized teacher", async () => {
    login(teacher);
    expect((await request("exams/" + exam)).status).toBe(200);
  });
  it("lists exam schedule and completed submission totals for teachers", async () => {
    login(teacher);
    const listedExam = randomUUID();
    const submittedUser = randomUUID();
    await db.execute(
      sql`INSERT INTO users(id,email,name,password_hash,role,student_id) VALUES(${submittedUser},${submittedUser + "@test.local"},'Submitted Student','unused','STUDENT','SUBMITTED-ID')`,
    );
    await db.execute(
      sql`INSERT INTO enrollments(course_id,user_id) VALUES(${course},${submittedUser})`,
    );
    await db.execute(
      sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${listedExam},${course},'Schedule details','PUBLISHED',now()-interval '1 hour',now()+interval '2 hours',60,'{}'::jsonb,'secret')`,
    );
    await db.execute(
      sql`INSERT INTO attempts(id,exam_id,user_id,device_session_id,deadline,status,submitted_at) VALUES(${randomUUID()},${listedExam},${submittedUser},${device},now(),'SUBMITTED',now())`,
    );
    const response = await request("exams");
    const rows = await response.json();
    const listed = rows.find((row: { id: string }) => row.id === listedExam);
    expect(response.status).toBe(200);
    expect(listed).toMatchObject({
      submitted: 1,
      checked_in: 0,
      enrolled: 3,
    });
    expect(listed.starts_at).toBeTruthy();
    expect(listed.ends_at).toBeTruthy();
  });
  it("limits student exam visibility to enrolled courses and removes access after unenrollment", async () => {
    const previousAllowlist = process.env.STUDENT_LOGIN_EMAILS;
    const scopedStudent = randomUUID();
    const secondCourse = randomUUID();
    const secondExam = randomUUID();
    await db.execute(
      sql`INSERT INTO users(id,email,name,password_hash,role,student_id) VALUES(${scopedStudent},${scopedStudent + "@test.local"},'Scoped Student','unused','STUDENT','SCOPED-ID')`,
    );
    process.env.STUDENT_LOGIN_EMAILS = [
      previousAllowlist,
      scopedStudent + "@test.local",
    ]
      .filter(Boolean)
      .join(",");
    await db.execute(
      sql`INSERT INTO courses(id,teacher_id,code,name) VALUES(${secondCourse},${teacher},'OTHER','Other course')`,
    );

    const added = await requestAs(teacher, `courses/${course}/enroll`, {
      email: scopedStudent + "@test.local",
    });
    expect(added.status).toBe(200);
    const rosterBeforeRemoval = await requestAs(
      teacher,
      `courses/${course}/students`,
    );
    expect(
      (await rosterBeforeRemoval.json()).some(
        (row: any) => row.id === scopedStudent,
      ),
    ).toBe(true);

    const removed = await requestSession.run(teacher, () =>
      deleteRequest(`courses/${course}/students/${scopedStudent}`),
    );
    expect(removed.status).toBe(200);
    const rosterAfterRemoval = await requestAs(
      teacher,
      `courses/${course}/students`,
    );
    expect(
      (await rosterAfterRemoval.json()).some(
        (row: any) => row.id === scopedStudent,
      ),
    ).toBe(false);

    await db.execute(
      sql`INSERT INTO enrollments(course_id,user_id) VALUES(${secondCourse},${scopedStudent})`,
    );
    const [sourceExam] = await query(
      sql`SELECT policy FROM exams WHERE id=${exam}`,
    );
    await db.execute(
      sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${secondExam},${secondCourse},'Other course exam','PUBLISHED',now()-interval '1 hour',now()+interval '2 hours',60,${JSON.stringify(sourceExam.policy)}::jsonb,'secret')`,
    );
    await db.execute(
      sql`INSERT INTO exam_questions(exam_id,question_id,position) VALUES(${secondExam},${question},0)`,
    );

    const studentExams = await requestAs(scopedStudent, "exams");
    expect(studentExams.status).toBe(200);
    const visible = await studentExams.json();
    expect(visible.map((row: any) => row.id)).toEqual([secondExam]);
    expect((await requestAs(scopedStudent, `exams/${exam}`)).status).toBe(403);
    if (previousAllowlist === undefined)
      delete process.env.STUDENT_LOGIN_EMAILS;
    else process.env.STUDENT_LOGIN_EMAILS = previousAllowlist;
  });
  it("enrolls students and publishes exams without sending email", async () => {
    const mailCourse = randomUUID();
    const mailStudent = randomUUID();
    const mailExam = randomUUID();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await db.execute(
        sql`INSERT INTO users(id,email,name,password_hash,role,student_id) VALUES(${mailStudent},'mail-student@test.local','Mail Student','unused','STUDENT','MAIL-ID')`,
      );
      await db.execute(
        sql`INSERT INTO courses(id,teacher_id,code,name) VALUES(${mailCourse},${teacher},'MAIL','Mail course')`,
      );
      const enrolled = await requestAs(
        teacher,
        `courses/${mailCourse}/enroll`,
        {
          email: "mail-student@test.local",
        },
      );
      expect(enrolled.status).toBe(200);
      expect(await enrolled.json()).not.toHaveProperty("notification");

      const [sourceExam] = await query(
        sql`SELECT policy FROM exams WHERE id=${exam}`,
      );
      await db.execute(
        sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${mailExam},${mailCourse},'Mail course midterm','DRAFT',now()-interval '1 hour',now()+interval '2 hours',60,${JSON.stringify(sourceExam.policy)}::jsonb,'secret')`,
      );
      await db.execute(
        sql`INSERT INTO exam_questions(exam_id,question_id,position) VALUES(${mailExam},${question},0)`,
      );
      const published = await requestAs(teacher, `exams/${mailExam}/control`, {
        action: "publish",
      });
      expect(published.status).toBe(200);
      expect(await published.json()).not.toHaveProperty("notification");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("lets a student save a unique ID for exam identity confirmation", async () => {
    login(student);
    const response = await request(
      "me/profile",
      { studentId: "BU123456" },
      {},
      "PATCH",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      studentId: "BU123456",
    });
    expect(
      (await query(sql`SELECT student_id FROM users WHERE id=${student}`))[0]
        .student_id,
    ).toBe("BU123456");
  });
  it("rejects a duplicate student ID", async () => {
    login(other);
    const response = await request(
      "me/profile",
      { studentId: "BU123456" },
      {},
      "PATCH",
    );
    expect(response.status).toBe(409);
  });
  it("lets a teacher edit and delete an owned classroom", async () => {
    login(teacher);
    const configuration = {
      name: "Lab 1",
      building: "Main",
      floor: "2",
      room: "201",
      latitude: 14,
      longitude: 100,
      radius: 100,
      accuracy: 100,
    };
    const created = await request("classrooms", configuration);
    expect(created.status).toBe(200);
    const { id } = await created.json();
    const edited = await request(
      "classrooms/" + id,
      { ...configuration, name: "Lab 2", latitude: 14.1 },
      {},
      "PATCH",
    );
    expect(edited.status).toBe(200);
    const listing = await request("classrooms");
    const rooms = await listing.json();
    expect(rooms.find((room: any) => room.id === id)).toMatchObject({
      name: "Lab 2",
      configuration: { name: "Lab 2", latitude: 14.1 },
    });
    expect((await deleteRequest("classrooms/" + id)).status).toBe(200);
    expect(
      (await (await request("classrooms")).json()).some(
        (room: any) => room.id === id,
      ),
    ).toBe(false);
  });
  it("rejects a foreign origin on mutation", async () => {
    login(teacher);
    expect(
      (
        await request(
          "exams/" + exam + "/control",
          { action: "pause" },
          { origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
  });
  it("does not expose questions or room secrets before entry", async () => {
    login(student);
    const data = await (await request("exams/" + exam)).json();
    expect(data.questions).toBeUndefined();
    expect(data.code_secret).toBeUndefined();
  });
  it("rejects entry before opening and after closing", async () => {
    login(student);
    await db.execute(
      sql`UPDATE exams SET starts_at=now()+interval '1 hour' WHERE id=${exam}`,
    );
    expect((await request("exams/" + exam + "/start", start)).status).toBe(409);
    await db.execute(
      sql`UPDATE exams SET starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour' WHERE id=${exam}`,
    );
    expect((await request("exams/" + exam + "/start", start)).status).toBe(409);
    await db.execute(
      sql`UPDATE exams SET ends_at=now()+interval '2 hours' WHERE id=${exam}`,
    );
  });
  it("rejects exam entry when full-screen sharing did not pass, even if unavailable is claimed", async () => {
    login(student);
    const response = await request("exams/" + exam + "/start", {
      ...start,
      checks: { ...start.checks, screen: false },
      screenShareUnavailable: true,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Required screen check has not passed.",
    });
  });
  it("allows tablet exam entry without screen sharing and disables tablet screen view", async () => {
    const tabletStudent = randomUUID();
    const tabletDevice = randomUUID();
    const previousAllowlist = process.env.STUDENT_LOGIN_EMAILS;
    process.env.STUDENT_LOGIN_EMAILS = [
      previousAllowlist,
      `${tabletStudent}@test.local`,
    ]
      .filter(Boolean)
      .join(",");
    await db.execute(
      sql`INSERT INTO users(id,email,name,password_hash,role,student_id) VALUES(${tabletStudent},${tabletStudent + "@test.local"},'Tablet Test','unused','STUDENT','TABLET-ID')`,
    );
    await db.execute(
      sql`INSERT INTO exam_devices(id,user_id,session_version) VALUES(${tabletDevice},${tabletStudent},0)`,
    );
    await db.execute(
      sql`INSERT INTO enrollments(course_id,user_id) VALUES(${course},${tabletStudent})`,
    );
    login(tabletStudent);
    const started = await request(
      `exams/${exam}/start`,
      {
        ...start,
        deviceSessionId: tabletDevice,
        deviceClass: "tablet",
        checks: { ...start.checks, screen: false },
      },
      {
        "user-agent":
          "Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/130 Safari/537.36",
        "sec-ch-ua-mobile": "?0",
      },
    );
    expect(started.status).toBe(200);
    const { id } = await started.json();
    const attempt = (
      await query(sql`SELECT device_state FROM attempts WHERE id=${id}`)
    )[0];
    expect(attempt.device_state).toMatchObject({
      deviceClass: "tablet",
      screen: false,
    });
    const tabletSync = await request(
      `attempts/${id}/sync`,
      { events: [{ id: randomUUID(), type: "SCREEN_SHARE_STOPPED" }] },
      { "x-exam-device": tabletDevice },
    );
    expect(tabletSync.status).toBe(200);
    expect(await tabletSync.json()).toMatchObject({ warnings: 0 });

    login(teacher);
    const screenStatus = await request(`attempts/${id}/screen`);
    expect(screenStatus.status).toBe(200);
    expect(await screenStatus.json()).toMatchObject({ supported: false });
    expect(
      (await request(`attempts/${id}/screen/request`, {}, {}, "POST")).status,
    ).toBe(409);
    await db.execute(
      sql`UPDATE attempts SET status='SUBMITTED',submitted_at=now() WHERE id=${id}`,
    );
    process.env.STUDENT_LOGIN_EMAILS = previousAllowlist ?? "";
    login(student);
  });
  it("requires explicit tablet camera-evidence consent and accepts consented warning images", async () => {
    const tabletStudent = randomUUID();
    const tabletDevice = randomUUID();
    const previousAllowlist = process.env.STUDENT_LOGIN_EMAILS;
    const previousBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.STUDENT_LOGIN_EMAILS = [
      previousAllowlist,
      `${tabletStudent}@test.local`,
    ]
      .filter(Boolean)
      .join(",");
    process.env.BLOB_READ_WRITE_TOKEN = "test-evidence-storage-token";
    const tabletPolicy = policySchema.parse({
      camera: true,
      microphone: false,
      location: false,
      fullscreen: false,
      classroomCode: false,
      screen: false,
    });
    await db.execute(
      sql`UPDATE exams SET policy=${JSON.stringify(tabletPolicy)}::jsonb WHERE id=${exam}`,
    );
    await db.execute(
      sql`INSERT INTO users(id,email,name,password_hash,role,student_id) VALUES(${tabletStudent},${tabletStudent + "@test.local"},'Tablet Evidence Test','unused','STUDENT','TABLET-EVIDENCE-ID')`,
    );
    await db.execute(
      sql`INSERT INTO exam_devices(id,user_id,session_version) VALUES(${tabletDevice},${tabletStudent},0)`,
    );
    await db.execute(
      sql`INSERT INTO enrollments(course_id,user_id) VALUES(${course},${tabletStudent})`,
    );
    login(tabletStudent);
    const tabletHeaders = {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/130 Safari/537.36",
      "sec-ch-ua-mobile": "?0",
    };
    const entry = {
      ...start,
      deviceSessionId: tabletDevice,
      deviceClass: "tablet" as const,
      checks: { ...start.checks, camera: true, screen: false },
    };
    const declined = await request(
      `exams/${exam}/start`,
      entry,
      tabletHeaders,
    );
    expect(declined.status).toBe(400);
    expect(await declined.json()).toMatchObject({
      error: "Accept the tablet camera-evidence notice.",
    });

    const started = await request(
      `exams/${exam}/start`,
      { ...entry, cameraEvidenceAccepted: true },
      tabletHeaders,
    );
    expect(started.status).toBe(200);
    const { id } = await started.json();
    const form = new FormData();
    form.append(
      "file",
      new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)], {
        type: "image/jpeg",
      }),
      `${randomUUID()}.jpg`,
    );
    form.append("examId", exam);
    form.append("attemptId", id);
    form.append("eventEvidence", "true");
    form.append("eventId", randomUUID());
    form.append("eventType", "CAMERA_MOTION");
    const uploaded = await uploadRequest("files", form, {
      "x-exam-device": tabletDevice,
    });
    expect(uploaded.status).toBe(200);
    expect(
      (await query(
        sql`SELECT name,mime FROM files WHERE attempt_id=${id} AND name LIKE 'EVIDENCE::CAMERA_MOTION::%'`,
      ))[0],
    ).toMatchObject({ mime: "image/jpeg" });
    await db.execute(sql`DELETE FROM files WHERE attempt_id=${id}`);
    await db.execute(
      sql`UPDATE attempts SET status='SUBMITTED',submitted_at=now() WHERE id=${id}`,
    );
    process.env.STUDENT_LOGIN_EMAILS = previousAllowlist ?? "";
    process.env.BLOB_READ_WRITE_TOKEN = previousBlobToken ?? "";
    await db.execute(
      sql`UPDATE exams SET policy=${JSON.stringify(policySchema.parse({ camera: false, microphone: false, location: false, fullscreen: false, classroomCode: false }))}::jsonb WHERE id=${exam}`,
    );
    login(student);
  });
  it("rejects an accurate outside location", async () => {
    const p = policySchema.parse({
      camera: false,
      microphone: false,
      location: true,
      fullscreen: false,
      classroomCode: false,
    });
    await db.execute(
      sql`UPDATE exams SET policy=${JSON.stringify(p)}::jsonb,classroom='{"latitude":14,"longitude":100,"radius":100,"accuracy":30}' WHERE id=${exam}`,
    );
    expect(
      (
        await request("exams/" + exam + "/start", {
          ...start,
          location: { latitude: 15, longitude: 100, accuracy: 5 },
        })
      ).status,
    ).toBe(400);
    p.location = false;
    await db.execute(
      sql`UPDATE exams SET policy=${JSON.stringify(p)}::jsonb WHERE id=${exam}`,
    );
  });
  it("rejects phone browsers even when an exam policy allows mobile", async () => {
    login(student);
    const p = policySchema.parse({
      camera: false,
      microphone: false,
      location: false,
      fullscreen: false,
      classroomCode: false,
      allowMobile: true,
    });
    await db.execute(
      sql`UPDATE exams SET policy=${JSON.stringify(p)}::jsonb WHERE id=${exam}`,
    );
    const response = await request(
      "exams/" + exam + "/start",
      { ...start, deviceClass: "phone" },
      {
        "user-agent":
          "Mozilla/5.0 (Linux; Android 14; Pixel 9) Chrome/130 Mobile Safari/537.36",
        "sec-ch-ua-mobile": "?1",
      },
    );
    expect(response.status).toBe(403);
    p.allowMobile = false;
    await db.execute(
      sql`UPDATE exams SET policy=${JSON.stringify(p)}::jsonb WHERE id=${exam}`,
    );
  });
  it("starts once and controls duplicate sessions", async () => {
    const r = await request("exams/" + exam + "/start", start);
    expect(r.status).toBe(200);
    attempt = (await r.json()).id;
    expect(
      (await (await request("exams/" + exam + "/start", start)).json()).id,
    ).toBe(attempt);
    expect(
      (
        await request("exams/" + exam + "/start", {
          ...start,
          deviceSessionId: randomUUID(),
        })
      ).status,
    ).toBe(409);
    login(teacher);
    expect((await request(`attempts/${attempt}/screen`)).status).toBe(200);
    login(student);
  });
  it("publishes and starts an exam that uses an uploaded Word paper instead of typed questions", async () => {
    const paperExam = randomUUID();
    process.env.BLOB_READ_WRITE_TOKEN = "test-private-storage-token";
    await db.execute(
      sql`UPDATE users SET name='Test',student_id='BU123' WHERE id=${other}`,
    );
    await db.execute(
      sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${paperExam},${course},'Document-only paper','DRAFT',now()-interval '1 hour',now()+interval '2 hours',60,${JSON.stringify(policySchema.parse({ camera: false, microphone: false, location: false, fullscreen: false, classroomCode: false }))}::jsonb,'secret')`,
    );
    await db.execute(
      sql`INSERT INTO files(id,exam_id,owner_id,name,mime,url,size) VALUES(${randomUUID()},${paperExam},${teacher},'Question paper.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','private-paper',10)`,
    );
    login(teacher);
    const published = await request(`exams/${paperExam}/control`, {
      action: "publish",
    });
    expect(published.status).toBe(200);

    const otherDevice = randomUUID();
    await db.execute(
      sql`INSERT INTO exam_devices(id,user_id,session_version) VALUES(${otherDevice},${other},0)`,
    );
    login(other);
    const started = await request(`exams/${paperExam}/start`, {
      ...start,
      deviceSessionId: otherDevice,
    });
    expect(started.status).toBe(200);
    const { id } = await started.json();
    const detail = await (
      await request(`attempts/${id}`, undefined, {
        "x-exam-device": otherDevice,
      })
    ).json();
    expect(detail.question_order).toEqual([]);
    expect(detail.files).toHaveLength(1);
    const docx = zipSync({
      "word/document.xml": strToU8(
        "<w:document><w:body><w:p><w:r><w:t>My completed answers</w:t></w:r></w:p></w:body></w:document>",
      ),
    });
    const form = new FormData();
    form.set(
      "file",
      new File([docx], "completed-paper.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    form.set("examId", paperExam);
    form.set("attemptId", id);
    form.set("documentSubmission", "true");
    const uploaded = await uploadRequest("files", form, {
      "x-exam-device": otherDevice,
    });
    expect(uploaded.status).toBe(200);
    const uploadedResult = await uploaded.json();
    expect(uploadedResult.name).toMatch(
      /Test_BU123_Document-only-paper\.docx$/,
    );
    const refreshed = await (
      await request(`attempts/${id}`, undefined, {
        "x-exam-device": otherDevice,
      })
    ).json();
    expect(refreshed.documentSubmission.name).toBe(uploadedResult.name);
    await db.execute(
      sql`UPDATE attempts SET status='SUBMITTED',submitted_at=now() WHERE id=${id}`,
    );
  });
  it("denies another student’s attempt and grading", async () => {
    login(other);
    expect((await request("attempts/" + attempt)).status).toBe(403);
    login(student);
    expect(
      (
        await request("attempts/" + attempt + "/grade", {
          marks: [],
          feedback: "",
        })
      ).status,
    ).toBe(403);
  });
  it("withholds answer keys, rubrics and unreleased grades", async () => {
    const r = await (await request("attempts/" + attempt)).json();
    expect(r.solutions).toBeUndefined();
    expect(r.questions[0].solution).toBeUndefined();
    expect(r.questions[0].rubric).toBeUndefined();
    expect(r.score).toBeNull();
  });
  it("refresh preserves the server deadline", async () => {
    const a = await (await request("attempts/" + attempt)).json();
    const b = await (await request("attempts/" + attempt)).json();
    expect(a.deadline).toBe(b.deadline);
  });
  it("autosaves monotonically and does not overwrite with old versions", async () => {
    const path = "attempts/" + attempt + "/sync";
    expect(
      (
        await request(path, {
          answers: [{ questionId: question, value: "SECRET_KEY", version: 2 }],
        })
      ).status,
    ).toBe(200);
    await request(path, {
      answers: [{ questionId: question, value: "B", version: 1 }],
    });
    const r = await (await request("attempts/" + attempt)).json();
    expect(r.answers[0].value).toBe("SECRET_KEY");
  });
  it("logs local audio and camera activity for instructor review without auto-penalizing", async () => {
    const path = "attempts/" + attempt + "/sync";
    const response = await request(path, {
      events: [
        {
          id: randomUUID(),
          type: "SPEECH_ACTIVITY",
          metadata: {
            sustainedSeconds: 4,
            measurement: "on-device audio level only",
          },
        },
        {
          id: randomUUID(),
          type: "CAMERA_MOTION",
          metadata: {
            changePercent: 42,
            measurement: "coarse on-device frame difference",
          },
        },
      ],
    });
    expect(response.status).toBe(200);
    const recorded = await query(
      sql`SELECT event_type,severity FROM audit_events WHERE attempt_id=${attempt} AND event_type IN('SPEECH_ACTIVITY','CAMERA_MOTION') ORDER BY event_type`,
    );
    expect(recorded.map((event) => [event.event_type, event.severity])).toEqual(
      [
        ["CAMERA_MOTION", "INFO"],
        ["SPEECH_ACTIVITY", "INFO"],
      ],
    );
    expect(
      (await query(sql`SELECT warnings FROM attempts WHERE id=${attempt}`))[0]
        .warnings,
    ).toBe(0);
  });
  it("records uncertain location without issuing a warning and confirms consecutive outside readings", async () => {
    await db.execute(
      sql`UPDATE exams SET policy=jsonb_set(policy,'{location}','true') WHERE id=${exam}`,
    );
    const path = "attempts/" + attempt + "/sync";
    await request(path, {
      events: [
        {
          id: randomUUID(),
          type: "LOCATION_CHECK",
          metadata: { latitude: 15, longitude: 100, accuracy: 2000 },
        },
      ],
    });
    expect(
      (await query(sql`SELECT warnings FROM attempts WHERE id=${attempt}`))[0]
        .warnings,
    ).toBe(0);
    for (let index = 1; index <= 2; index++) {
      await db.execute(
        sql`UPDATE attempts SET last_location_at=now()-interval '16 seconds' WHERE id=${attempt}`,
      );
      await request(path, {
        events: [
          {
            id: randomUUID(),
            type: "LOCATION_CHECK",
            metadata: { latitude: 15, longitude: 100, accuracy: 5 },
          },
        ],
      });
      expect(
        (await query(sql`SELECT warnings FROM attempts WHERE id=${attempt}`))[0]
          .warnings,
      ).toBe(index === 1 ? 0 : 1);
    }
    await db.execute(
      sql`UPDATE exams SET policy=jsonb_set(policy,'{location}','false') WHERE id=${exam}`,
    );
    await db.execute(
      sql`UPDATE attempts SET warnings=0,last_warning_at=NULL WHERE id=${attempt}`,
    );
  });
  it("deduplicates repeated and overlapping browser events", async () => {
    const id = randomUUID(),
      path = "attempts/" + attempt + "/sync";
    const payload = { events: [{ id, type: "TAB_HIDDEN" }] };
    await Promise.all([request(path, payload), request(path, payload)]);
    await request(path, {
      events: [{ id: randomUUID(), type: "FULLSCREEN_EXIT" }],
    });
    const [a] = await query(
      sql`SELECT warnings FROM attempts WHERE id=${attempt}`,
    );
    expect(a.warnings).toBe(1);
  });
  it("auto submits atomically at the fifth warning and locks answers", async () => {
    for (let i = 0; i < 4; i++) {
      await db.execute(
        sql`UPDATE attempts SET last_warning_at=now()-interval '11 seconds' WHERE id=${attempt}`,
      );
      await request("attempts/" + attempt + "/sync", {
        events: [{ id: randomUUID(), type: "TAB_HIDDEN" }],
        answers: [{ questionId: question, value: "SECRET_KEY", version: 3 }],
      });
    }
    const a = await (await request("attempts/" + attempt)).json();
    expect(a.status).toBe("AUTO_SUBMITTED_SECURITY");
    expect(a.warnings).toBe(5);
    await request("attempts/" + attempt + "/sync", {
      answers: [{ questionId: question, value: "B", version: 4 }],
    });
    expect(
      (await (await request("attempts/" + attempt)).json()).answers[0].value,
    ).toBe("SECRET_KEY");
  });
  it("keeps submission idempotent", async () => {
    await request("attempts/" + attempt + "/submit", {});
    await request("attempts/" + attempt + "/submit", {});
    const rows = await query(
      sql`SELECT id FROM audit_events WHERE attempt_id=${attempt} AND event_type='AUTO_SUBMITTED_SECURITY'`,
    );
    expect(rows.length).toBe(1);
  });
  it("never allows audit mutation", async () => {
    await expect(
      db.execute(sql`DELETE FROM audit_events WHERE attempt_id=${attempt}`),
    ).rejects.toThrow();
  });
  it("expires without trusting browser timestamps", async () => {
    login(other);
    await db.execute(
      sql`UPDATE exam_devices SET user_id=${other} WHERE id=${device}`,
    );
    const r = await (
      await request("exams/" + exam + "/start", {
        ...start,
        deviceSessionId: device,
      })
    ).json();
    await db.execute(
      sql`UPDATE attempts SET deadline=now()-interval '1 second' WHERE id=${r.id}`,
    );
    const result = await (
      await request("attempts/" + r.id + "/sync", {
        serverTime: "1900-01-01",
        answers: [],
      })
    ).json();
    expect(result.status).toBe("AUTO_SUBMITTED_TIME");
  });
  it("teacher exports and moderation are authorized and audited", async () => {
    login(teacher);
    expect((await request("exams/" + exam + "/export")).status).toBe(200);
    expect(
      (
        await request("attempts/" + attempt + "/control", {
          action: "review",
          note: "Reviewed browser failure; no misconduct finding.",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await query(
          sql`SELECT id FROM audit_events WHERE attempt_id=${attempt} AND event_type='ADMIN_review'`,
        )
      ).length,
    ).toBe(1);
  });
});

it("authenticates cron and expires an offline attempt", async () => {
  const { GET: cron } = await import("../src/app/api/cron/route");
  process.env.CRON_SECRET = randomUUID();
  expect(
    (await cron(new Request("http://localhost:3000/api/cron"))).status,
  ).toBe(401);
  await db.execute(
    sql`UPDATE attempts SET status='ACTIVE',deadline=now()-interval '1 second' WHERE id=${attempt}`,
  );
  const r = await cron(
    new Request("http://localhost:3000/api/cron", {
      headers: { authorization: "Bearer " + process.env.CRON_SECRET },
    }),
  );
  expect(r.status).toBe(200);
  expect((await r.json()).expired).toBe(1);
});

it("permanently removes an exam and every related result and private file", async () => {
  login(teacher);
  const fileId = randomUUID();
  await db.execute(
    sql`INSERT INTO files(id,exam_id,owner_id,name,mime,url,size) VALUES(${fileId},${exam},${teacher},'Old paper.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','private-paper',10)`,
  );

  const activePaperDelete = await deleteRequest(`files/${fileId}`);
  expect(activePaperDelete.status).toBe(409);
  expect(blob.del).not.toHaveBeenCalled();

  await db.execute(sql`UPDATE exams SET status='CLOSED' WHERE id=${exam}`);
  const deletedFile = await deleteRequest(`files/${fileId}`);
  expect(deletedFile.status).toBe(200);
  expect(blob.del).toHaveBeenCalledWith("private-paper");
  expect(
    await query(sql`SELECT id FROM files WHERE id=${fileId}`),
  ).toHaveLength(0);

  const deletedQuestion = await deleteRequest(`questions/${question}`);
  expect(deletedQuestion.status).toBe(200);
  expect(
    await query(
      sql`SELECT id FROM questions WHERE id=${question} AND deleted_at IS NULL`,
    ),
  ).toHaveLength(0);
  const examDetail = await (await request(`exams/${exam}`)).json();
  expect(examDetail.questions.map((q: { id: string }) => q.id)).toContain(
    question,
  );

  const submissionFileId = randomUUID();
  let [submittedAttempt] = await query<{ id: string }>(
    sql`SELECT id FROM attempts WHERE exam_id=${exam} ORDER BY started_at LIMIT 1`,
  );
  if (!submittedAttempt) {
    const attemptId = randomUUID();
    await db.execute(
      sql`INSERT INTO attempts(id,exam_id,user_id,device_session_id,deadline,question_order,status,submitted_at) VALUES(${attemptId},${exam},${student},${device},now(),${JSON.stringify([question])}::jsonb,'SUBMITTED',now())`,
    );
    await db.execute(
      sql`INSERT INTO answers(attempt_id,question_id,value) VALUES(${attemptId},${question},'"answer"'::jsonb)`,
    );
    submittedAttempt = { id: attemptId };
  }
  await db.execute(
    sql`INSERT INTO files(id,exam_id,attempt_id,owner_id,name,mime,url,size) VALUES(${submissionFileId},${exam},${submittedAttempt.id},${student},'SUBMISSION::Test.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','private-submission',20)`,
  );

  const deletedExam = await deleteRequest(`exams/${exam}`);
  expect(deletedExam.status).toBe(200);
  const deleteResult = await deletedExam.json();
  expect(deleteResult).toMatchObject({
    ok: true,
    deletedFiles: 1,
    pendingStorageCleanup: 0,
  });
  expect(blob.del).toHaveBeenCalledWith("private-submission");
  expect((await request("exams")).status).toBe(200);
  expect(
    (await (await request("exams")).json()).some(
      (row: { id: string }) => row.id === exam,
    ),
  ).toBe(false);
  expect((await request(`exams/${exam}`)).status).toBe(404);
  expect(
    await query(sql`SELECT id FROM attempts WHERE exam_id=${exam}`),
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT attempt_id FROM answers WHERE attempt_id=${submittedAttempt.id}`,
    ),
  ).toHaveLength(0);
  expect(
    await query(sql`SELECT id FROM files WHERE exam_id=${exam}`),
  ).toHaveLength(0);
  expect(
    await query(
      sql`SELECT id FROM audit_events WHERE exam_id=${exam} OR attempt_id=${submittedAttempt.id}`,
    ),
  ).toHaveLength(0);
  expect(
    await query(sql`SELECT exam_id FROM exam_questions WHERE exam_id=${exam}`),
  ).toHaveLength(0);
  expect(
    await query(sql`SELECT id FROM questions WHERE id=${question}`),
  ).toHaveLength(1);

  const retryExam = randomUUID();
  await db.execute(
    sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${retryExam},${course},'Storage retry','CLOSED',now()-interval '2 hours',now()-interval '1 hour',60,${JSON.stringify(policySchema.parse({ camera: false, microphone: false, location: false, fullscreen: false, classroomCode: false }))}::jsonb,'secret')`,
  );
  const retryFile = randomUUID();
  await db.execute(
    sql`INSERT INTO files(id,exam_id,owner_id,name,mime,url,size) VALUES(${retryFile},${retryExam},${teacher},'Paper.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document','retryable-private-file',10)`,
  );
  blob.del.mockRejectedValueOnce(new Error("simulated storage outage"));
  const failedStorageDelete = await deleteRequest(`exams/${retryExam}`);
  expect(failedStorageDelete.status).toBe(200);
  expect(await failedStorageDelete.json()).toMatchObject({
    ok: true,
    deletedFiles: 1,
    pendingStorageCleanup: 1,
  });
  expect((await request(`exams/${retryExam}`)).status).toBe(404);
  expect(
    await query(
      sql`SELECT id FROM storage_cleanup_jobs WHERE exam_id=${retryExam}`,
    ),
  ).toHaveLength(1);

  await db.execute(
    sql`UPDATE storage_cleanup_jobs SET next_attempt_at=now()-interval '1 second' WHERE exam_id=${retryExam}`,
  );
  const { processStorageCleanupJobs } =
    await import("../src/lib/storage-cleanup");
  expect(await processStorageCleanupJobs(10)).toMatchObject({
    cleaned: 1,
    failed: 0,
  });
  expect(blob.del).toHaveBeenCalledWith("retryable-private-file");
  expect(
    await query(
      sql`SELECT id FROM storage_cleanup_jobs WHERE exam_id=${retryExam}`,
    ),
  ).toHaveLength(0);

  const legacyDeletedExam = randomUUID();
  const legacyAttempt = randomUUID();
  await db.execute(
    sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret,deleted_at) VALUES(${legacyDeletedExam},${course},'Legacy deleted exam','CLOSED',now()-interval '2 hours',now()-interval '1 hour',60,${JSON.stringify(policySchema.parse({ camera: false, microphone: false, location: false, fullscreen: false, classroomCode: false }))}::jsonb,'secret',now())`,
  );
  await db.execute(
    sql`INSERT INTO attempts(id,exam_id,user_id,device_session_id,deadline,question_order,status,submitted_at) VALUES(${legacyAttempt},${legacyDeletedExam},${student},${device},now(),${JSON.stringify([question])}::jsonb,'SUBMITTED',now())`,
  );
  const visibleSubmissions = await (await request("growth/submissions")).json();
  expect(
    visibleSubmissions.some(
      (submission: { exam_id: string }) =>
        submission.exam_id === legacyDeletedExam,
    ),
  ).toBe(false);

  const events = await query<any>(
    sql`SELECT * FROM audit_events ORDER BY sequence`,
  );
  const previous = new Map<string, string>();
  for (const event of events) {
    const prior = previous.get(event.chain_key) ?? "GENESIS";
    const data = {
      id: event.id,
      chain: event.chain_key,
      examId: event.exam_id,
      attemptId: event.attempt_id,
      userId: event.user_id,
      type: event.event_type,
      severity: event.severity,
      metadata: event.metadata,
      createdAt: new Date(event.created_at).toISOString(),
    };
    expect(event.previous_hash).toBe(prior);
    expect(auditHash(prior, data)).toBe(event.event_hash);
    previous.set(event.chain_key, event.event_hash);
  }
});

it("adds a generated paper to only its draft exam and keeps it out of the bank", async () => {
  login(teacher);
  const paperExam = randomUUID();
  await db.execute(
    sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${paperExam},${course},'AI paper draft','DRAFT',now()+interval '1 hour',now()+interval '2 hours',60,${JSON.stringify(policySchema.parse({ camera: false, microphone: false, location: false, fullscreen: false, classroomCode: false }))}::jsonb,'secret')`,
  );
  const response = await request(`exams/${paperExam}/paper`, {
    questions: [
      {
        type: "MCQ",
        prompt: "Which structure follows FIFO?",
        marks: 2,
        options: ["Stack", "Queue", "Tree", "Set"],
        solution: "Queue",
        rubric: "One mark for queue and one for FIFO explanation.",
        topic: "Data structures",
        difficulty: "Easy",
      },
    ],
  });
  expect(response.status).toBe(200);
  expect((await response.json()).count).toBe(1);
  const detail = await (await request(`exams/${paperExam}`)).json();
  expect(detail.questions).toHaveLength(1);
  expect(detail.questions[0].prompt).toBe("Which structure follows FIFO?");
  expect(
    detail.availableQuestions.some(
      (q: { prompt: string }) => q.prompt === detail.questions[0].prompt,
    ),
  ).toBe(false);
  const bank = await (await request("questions")).json();
  expect(
    bank.some(
      (q: { prompt: string }) => q.prompt === detail.questions[0].prompt,
    ),
  ).toBe(false);
});

it("uploads searchable PDF text so it can be loaded into the question builder", async () => {
  login(teacher);
  process.env.BLOB_READ_WRITE_TOKEN = "test-private-storage-token";
  const paperExam = randomUUID();
  await db.execute(
    sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${paperExam},${course},'Searchable PDF upload','DRAFT',now()+interval '1 hour',now()+interval '2 hours',60,${JSON.stringify(policySchema.parse({ camera: false, microphone: false, location: false, fullscreen: false, classroomCode: false }))}::jsonb,'secret')`,
  );
  const form = new FormData();
  form.set(
    "file",
    new File(
      [
        searchablePdf([
          "PART A - MULTIPLE CHOICE",
          "A1. Which answer is correct?",
        ]),
      ],
      "paper.pdf",
      {
        type: "application/pdf",
      },
    ),
  );
  form.set("examId", paperExam);
  const response = await uploadRequest("files", form);
  expect(response.status).toBe(200);
  const detail = await (await request(`exams/${paperExam}`)).json();
  expect(detail.files[0].name).toBe("paper.pdf");
  expect(detail.files[0].extracted_text).toContain(
    "A1. Which answer is correct?",
  );
});

it("uses Ollama for answer suggestions while keeping a labeled source paper unchanged", async () => {
  login(teacher);
  const paperExam = randomUUID();
  await db.execute(
    sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${paperExam},${course},'Source faithful AI paper','DRAFT',now()+interval '1 hour',now()+interval '2 hours',60,${JSON.stringify(policySchema.parse({ camera: false, microphone: false, location: false, fullscreen: false, classroomCode: false }))}::jsonb,'secret')`,
  );
  vi.stubEnv("OLLAMA_ENABLED", "true");
  vi.stubEnv("OLLAMA_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        message: {
          content: JSON.stringify({
            answers: [
              {
                sourceId: "A1",
                solution: "B",
                rubric: "Award one mark for B.",
                topic: "Business",
                difficulty: "Easy",
              },
              {
                sourceId: "C1",
                solution: "Source answer",
                rubric: "Award for a correct explanation.",
                topic: "Business",
                difficulty: "Medium",
              },
            ],
          }),
        },
      }),
    ),
  );
  try {
    const response = await request(`exams/${paperExam}/ai-paper-draft`, {
      source: `PART A — MULTIPLE CHOICE (1 × 1 = 1 mark)\nType the letter of the best answer.\nA1. Select the exact answer.\nA) First choice\nB) Second choice\nAnswer (A/B):\n\nPART C — SHORT ANSWER (1 × 2 = 2 marks)\nAnswer in one sentence.\nC1. Explain this source idea.\nAnswer (type here):`,
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]).toMatchObject({
      prompt:
        "Type the letter of the best answer.\n\nA1. Select the exact answer.",
      options: ["A) First choice", "B) Second choice"],
      solution: "B) Second choice",
      marks: 1,
    });
    expect(result.questions[1].prompt).toContain(
      "C1. Explain this source idea.",
    );
    expect(result.questions[1].prompt).toContain("Answer in one sentence.");
    expect(result.notice).toBe("");
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it("keeps a source-faithful question draft when Ollama is unavailable", async () => {
  login(teacher);
  const paperExam = randomUUID();
  await db.execute(
    sql`INSERT INTO exams(id,course_id,title,status,starts_at,ends_at,duration_minutes,policy,code_secret) VALUES(${paperExam},${course},'AI offline fallback','DRAFT',now()+interval '1 hour',now()+interval '2 hours',60,${JSON.stringify(policySchema.parse({ camera: false, microphone: false, location: false, fullscreen: false, classroomCode: false }))}::jsonb,'secret')`,
  );
  vi.stubEnv("OLLAMA_ENABLED", "true");
  vi.stubEnv("OLLAMA_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Ollama unavailable");
    }),
  );
  try {
    const response = await request(`exams/${paperExam}/ai-paper-draft`, {
      source: `PART A — MULTIPLE CHOICE (1 × 1 = 1 mark)\nType the letter of the best answer.\nA1. Which option was supplied?\nA) Original first\nB) Original second\n\nPART C — SHORT ANSWER (1 × 2 = 2 marks)\nC1. Explain the supplied idea.`,
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].prompt).toContain(
      "A1. Which option was supplied?",
    );
    expect(result.questions[0].options).toEqual([
      "A) Original first",
      "B) Original second",
    ]);
    expect(
      result.questions.every(
        (question: { solution: unknown }) => question.solution === null,
      ),
    ).toBe(true);
    expect(result.notice).toContain("Ollama did not return");
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
