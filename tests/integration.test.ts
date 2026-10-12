import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
const auth = vi.hoisted(() => ({ session: null as any }));
vi.mock("next-auth", () => ({ getServerSession: async () => auth.session }));
process.env.DATABASE_PROVIDER = "pglite";
process.env.PGLITE_PATH = "./.data/test-" + randomUUID();
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
const { db, query } = await import("../src/lib/db");
const { GET, POST } = await import("../src/app/api/platform/[...path]/route");
const { policySchema } = await import("../src/lib/domain");
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
) {
  const request = new Request("http://localhost:3000/api/platform/" + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0 Safari/537.36",
      "x-exam-device": device,
      ...extra,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return (data === undefined ? GET : POST)(request, {
    params: Promise.resolve({ path: path.split("/") }),
  });
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
      sql`INSERT INTO users(id,email,name,password_hash,role) VALUES(${id},${id + "@test.local"},'Test','unused',${role})`,
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
  it('records uncertain location without issuing a warning and confirms consecutive outside readings',async()=>{
    await db.execute(sql`UPDATE exams SET policy=jsonb_set(policy,'{location}','true') WHERE id=${exam}`);
    const path='attempts/'+attempt+'/sync';
    await request(path,{events:[{id:randomUUID(),type:'LOCATION_CHECK',metadata:{latitude:15,longitude:100,accuracy:2000}}]});
    expect((await query(sql`SELECT warnings FROM attempts WHERE id=${attempt}`))[0].warnings).toBe(0);
    for(let index=1;index<=2;index++){
      await db.execute(sql`UPDATE attempts SET last_location_at=now()-interval '16 seconds' WHERE id=${attempt}`);
      await request(path,{events:[{id:randomUUID(),type:'LOCATION_CHECK',metadata:{latitude:15,longitude:100,accuracy:5}}]});
      expect((await query(sql`SELECT warnings FROM attempts WHERE id=${attempt}`))[0].warnings).toBe(index===1?0:1);
    }
    await db.execute(sql`UPDATE exams SET policy=jsonb_set(policy,'{location}','false') WHERE id=${exam}`);
    await db.execute(sql`UPDATE attempts SET warnings=0,last_warning_at=NULL WHERE id=${attempt}`);
  });
  it("deduplicates repeated and overlapping browser events", async () => {
    const id = randomUUID(),
      path = "attempts/" + attempt + "/sync";
    const payload = { events: [{ id, type: "TAB_HIDDEN" }] };
    await Promise.all([request(path,payload),request(path,payload)]);
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

it('authenticates cron and expires an offline attempt',async()=>{
  const {GET:cron}=await import('../src/app/api/cron/route');
  process.env.CRON_SECRET=randomUUID();
  expect((await cron(new Request('http://localhost:3000/api/cron'))).status).toBe(401);
  await db.execute(sql`UPDATE attempts SET status='ACTIVE',deadline=now()-interval '1 second' WHERE id=${attempt}`);
  const r=await cron(new Request('http://localhost:3000/api/cron',{headers:{authorization:'Bearer '+process.env.CRON_SECRET}}));
  expect(r.status).toBe(200);expect((await r.json()).expired).toBe(1);
});
