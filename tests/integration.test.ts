import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
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
const { policySchema, createCourseEnrollmentInvite } =
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
    screen: false,
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

it("lets teachers remove old exams, papers, and bank questions safely", async () => {
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

  const deletedExam = await deleteRequest(`exams/${exam}`);
  expect(deletedExam.status).toBe(200);
  expect((await request("exams")).status).toBe(200);
  expect(
    (await (await request("exams")).json()).some(
      (row: { id: string }) => row.id === exam,
    ),
  ).toBe(false);
  expect((await request(`exams/${exam}`)).status).toBe(404);
  expect(
    (await query(sql`SELECT id FROM attempts WHERE exam_id=${exam}`)).length,
  ).toBeGreaterThan(0);
  expect(
    await query(
      sql`SELECT id FROM audit_events WHERE exam_id=${exam} AND event_type='EXAM_DELETED'`,
    ),
  ).toHaveLength(1);
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
