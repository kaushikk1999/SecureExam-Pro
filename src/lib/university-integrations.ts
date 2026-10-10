import { randomUUID, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, query } from "./db";
import { HttpError, type Actor } from "./auth";
import { audit, record } from "./audit";
import { uuid } from "./validation";

const externalId = z.string().regex(/^\d{1,20}$/);
export function ssoConfigured() {
  return Boolean(
    process.env.SSO_ISSUER?.startsWith("https://") &&
    process.env.SSO_CLIENT_ID &&
    process.env.SSO_CLIENT_SECRET,
  );
}
function canvasOrigin() {
  if (!process.env.CANVAS_BASE_URL || !process.env.CANVAS_ACCESS_TOKEN)
    throw new HttpError(
      503,
      "Canvas is not configured. Set CANVAS_BASE_URL and CANVAS_ACCESS_TOKEN on the server.",
    );
  const url = new URL(process.env.CANVAS_BASE_URL);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new HttpError(503, "Canvas base URL must be an HTTPS origin.");
  return url.origin;
}
export async function canvasFetch(path: string, init: RequestInit = {}) {
  const origin = canvasOrigin(),
    url = new URL(path, origin);
  if (url.origin !== origin || !url.pathname.startsWith("/api/v1/"))
    throw new HttpError(502, "Invalid Canvas API destination.");
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.CANVAS_ACCESS_TOKEN,
      },
    });
  } catch {
    throw new HttpError(
      502,
      "Canvas is unreachable. Check configuration and try again.",
    );
  }
  if (!response.ok)
    throw new HttpError(
      502,
      `Canvas returned HTTP ${response.status}. Check access and mapping.`,
    );
  return response;
}
async function roster(courseId: string) {
  const [link] = await query(
    sql`SELECT external_id FROM lms_course_links WHERE course_id=${courseId}`,
  );
  if (!link) throw new HttpError(400, "Map this course to Canvas first.");
  let path = `/api/v1/courses/${link.external_id}/enrollments?type[]=StudentEnrollment&state[]=active&per_page=100`;
  const students = new Map<string, any>();
  let pages = 0;
  while (path) {
    if (++pages > 20)
      throw new HttpError(
        400,
        "Roster exceeds the 2,000-entry import limit. Split the course before importing.",
      );
    const response = await canvasFetch(path);
    const rows = z
      .array(
        z.object({
          user: z.object({
            id: z.number().int().positive(),
            name: z.string().min(1).max(120),
            login_id: z.string().optional(),
            email: z.string().optional(),
            sis_user_id: z.string().nullable().optional(),
          }),
        }),
      )
      .parse(await response.json());
    for (const { user } of rows) {
      const email = z
        .email()
        .max(254)
        .safeParse((user.email || user.login_id || "").trim().toLowerCase());
      if (!email.success)
        throw new HttpError(
          400,
          "A Canvas student has no usable email. Correct the roster before syncing.",
        );
      students.set(String(user.id), {
        externalId: String(user.id),
        email: email.data,
        name: user.name,
      });
    }
    path =
      response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? "";
  }
  const entries = [];
  const seen = new Set<string>();
  for (const row of students.values()) {
    if (seen.has(row.email))
      throw new HttpError(409, "Canvas roster contains duplicate emails.");
    seen.add(row.email);
    const [mapped] = await query(
      sql`SELECT u.id,u.email,u.role FROM lms_users l JOIN users u ON u.id=l.user_id WHERE l.external_id=${row.externalId}`,
    );
    const [existing] = await query(
      sql`SELECT id,role,active FROM users WHERE lower(email)=${row.email}`,
    );
    if (
      (existing && existing.role !== "STUDENT") ||
      (mapped && mapped.email !== row.email) ||
      (mapped && mapped.role !== "STUDENT")
    )
      throw new HttpError(
        409,
        "Roster mapping conflicts with an existing account. Resolve the identity before importing.",
      );
    const [other] = existing
      ? await query(
          sql`SELECT external_id FROM lms_users WHERE user_id=${existing.id}`,
        )
      : [];
    if (other && other.external_id !== row.externalId)
      throw new HttpError(
        409,
        "This local student is already mapped to another Canvas identity.",
      );
    entries.push({
      ...row,
      userId: existing?.id ?? null,
      action: existing
        ? "Enroll existing student"
        : "Create student and enroll",
    });
  }
  return {
    origin: canvasOrigin(),
    courseId,
    externalCourseId: link.external_id,
    entries: entries.sort((a, b) => a.externalId.localeCompare(b.externalId)),
  };
}
async function grades(examId: string, offset = 0) {
  const [e] = await query(
    sql`SELECT e.id,e.results_released,l.external_id AS assignment_id,c.external_id AS canvas_course FROM exams e JOIN lms_exam_links l ON l.exam_id=e.id JOIN lms_course_links c ON c.course_id=e.course_id WHERE e.id=${examId}`,
  );
  if (!e)
    throw new HttpError(400, "Map the exam and its course to Canvas first.");
  if (!e.results_released)
    throw new HttpError(
      409,
      "Release exam results before previewing grade sync.",
    );
  const rows = await query(
    sql`SELECT a.id,a.score,u.name,l.external_id,(SELECT sum(q.marks) FROM questions q WHERE q.id IN(SELECT jsonb_array_elements_text(a.question_order)::uuid)) AS maximum FROM attempts a JOIN users u ON u.id=a.user_id LEFT JOIN lms_users l ON l.user_id=a.user_id WHERE a.exam_id=${examId} AND a.status<>'ACTIVE' ORDER BY a.id`,
  );
  return {
    origin: canvasOrigin(),
    examId,
    offset,
    total: rows.length,
    nextOffset: offset + 20 < rows.length ? offset + 20 : null,
    externalCourseId: e.canvas_course,
    assignmentId: e.assignment_id,
    entries: rows.slice(offset, offset + 20).map((r) => ({
      ...r,
      percent:
        r.score !== null && Number(r.maximum) > 0
          ? (100 * Number(r.score)) / Number(r.maximum)
          : null,
      skip: !r.external_id
        ? "No Canvas identity"
        : r.score === null
          ? "Grading incomplete"
          : !(Number(r.maximum) > 0)
            ? "No maximum marks"
            : null,
    })),
  };
}
export async function integrationRequest(
  req: Request,
  parts: string[],
  u: Actor,
  body: () => Promise<any>,
) {
  if (u.role !== "ADMIN")
    throw new HttpError(
      403,
      "Only administrators manage university integrations.",
    );
  const [action, id] = parts;
  if (req.method === "GET") {
    if (action) throw new HttpError(404, "Integration route not found.");
    return {
      google: {
        configured: Boolean(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
        ),
        callback: "/api/auth/callback/google",
      },
      sso: {
        configured: ssoConfigured(),
        issuer: process.env.SSO_ISSUER ?? "",
        callback: "/api/auth/callback/university",
      },
      canvas: {
        configured: Boolean(
          process.env.CANVAS_BASE_URL && process.env.CANVAS_ACCESS_TOKEN,
        ),
        origin: process.env.CANVAS_BASE_URL ?? "",
      },
      courses: await query(
        sql`SELECT c.id,c.code,c.name,l.external_id FROM courses c LEFT JOIN lms_course_links l ON l.course_id=c.id ORDER BY c.code`,
      ),
      exams: await query(
        sql`SELECT e.id,e.title,l.external_id FROM exams e LEFT JOIN lms_exam_links l ON l.exam_id=e.id ORDER BY e.created_at DESC`,
      ),
      identities: await query(
        sql`SELECT s.issuer,s.subject,s.user_id,u.email FROM sso_identities s JOIN users u ON u.id=s.user_id ORDER BY u.email`,
      ),
      runs: await query(
        sql`SELECT id,kind,target_id,status,result,created_at,updated_at FROM integration_runs ORDER BY created_at DESC LIMIT 30`,
      ),
    };
  }
  if (req.method !== "POST") throw new HttpError(405, "POST required.");
  if (action === "identity") {
    const v = z
      .object({
        email: z.email().max(254),
        subject: z.string().trim().min(1).max(255),
        remove: z.boolean().default(false),
      })
      .parse(await body());
    if (!ssoConfigured())
      throw new HttpError(
        503,
        "Configure the university OpenID Connect provider first.",
      );
    const issuer = process.env.SSO_ISSUER!;
    await db.transaction(async (tx) => {
      const [account] = await query(
        sql`SELECT id FROM users WHERE email=${v.email.toLowerCase()} AND active=true`,
        tx,
      );
      if (!account)
        throw new HttpError(
          404,
          "Active local account not found. Create it before mapping SSO.",
        );
      if (v.remove)
        await tx.execute(
          sql`DELETE FROM sso_identities WHERE issuer=${issuer} AND subject=${v.subject} AND user_id=${account.id}`,
        );
      else
        await tx.execute(
          sql`INSERT INTO sso_identities(issuer,subject,user_id) VALUES(${issuer},${v.subject},${account.id})`,
        );
      await tx.execute(
        sql`UPDATE users SET session_version=session_version+1 WHERE id=${account.id}`,
      );
      await audit(tx, {
        userId: u.id,
        type: v.remove ? "SSO_IDENTITY_REMOVED" : "SSO_IDENTITY_LINKED",
        metadata: { userId: account.id },
      });
    });
    return { ok: true };
  }
  if (action === "mapping") {
    const v = z
      .object({ kind: z.enum(["course", "exam"]), localId: uuid, externalId })
      .parse(await body());
    await db.transaction(async (tx) => {
      const rows =
        v.kind === "course"
          ? await query(sql`SELECT id FROM courses WHERE id=${v.localId}`, tx)
          : await query(sql`SELECT id FROM exams WHERE id=${v.localId}`, tx);
      if (!rows.length)
        throw new HttpError(404, "Local course or exam not found.");
      if (v.kind === "course")
        await tx.execute(
          sql`INSERT INTO lms_course_links(course_id,external_id) VALUES(${v.localId},${v.externalId}) ON CONFLICT(course_id) DO UPDATE SET external_id=EXCLUDED.external_id,updated_at=now()`,
        );
      else
        await tx.execute(
          sql`INSERT INTO lms_exam_links(exam_id,external_id) VALUES(${v.localId},${v.externalId}) ON CONFLICT(exam_id) DO UPDATE SET external_id=EXCLUDED.external_id,updated_at=now()`,
        );
      await audit(tx, {
        userId: u.id,
        type: "LMS_MAPPING_UPDATED",
        metadata: v,
      });
    });
    return { ok: true };
  }
  if (action === "preview") {
    const v = z
      .object({
        kind: z.enum(["ROSTER", "GRADES"]),
        targetId: uuid,
        offset: z.number().int().min(0).max(100000).default(0),
      })
      .parse(await body());
    canvasOrigin();
    const preview =
      v.kind === "ROSTER"
        ? await roster(v.targetId)
        : await grades(v.targetId, v.offset);
    const runId = randomUUID();
    await query(
      sql`INSERT INTO integration_runs(id,actor_id,kind,target_id,preview) VALUES(${runId},${u.id},${v.kind},${v.targetId},${JSON.stringify(preview)}::jsonb)`,
    );
    return { id: runId, ...v, preview };
  }
  if (action === "confirm") {
    uuid.parse(id);
    const [run] = await query(
      sql`SELECT * FROM integration_runs WHERE id=${id} AND actor_id=${u.id}`,
    );
    if (!run || run.status !== "PREVIEW")
      throw new HttpError(
        409,
        "Preview already used or unavailable. Create a new preview.",
      );
    if (Date.now() - new Date(run.created_at).getTime() > 15 * 60 * 1000)
      throw new HttpError(
        409,
        "Preview expired. Preview again before syncing.",
      );
    const fresh =
      run.kind === "ROSTER"
        ? await roster(run.target_id)
        : await grades(run.target_id, run.preview.offset ?? 0);
    // JSONB key ordering differs from JSON.stringify; compare a canonical representation.
    if (canonical(fresh) !== canonical(run.preview))
      throw new HttpError(
        409,
        "Data or mapping changed. Generate a new preview.",
      );
    const claimed = await query(
      sql`UPDATE integration_runs SET status='RUNNING',updated_at=now() WHERE id=${id} AND status='PREVIEW' RETURNING id`,
    );
    if (!claimed.length) throw new HttpError(409, "Sync already started.");
    const results: any[] = [];
    try {
      if (run.kind === "ROSTER") {
        const password = await hash(randomBytes(32).toString("hex"), 12);
        await db.transaction(async (tx) => {
          for (const row of run.preview.entries) {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext(${row.email}))`,
            );
            const [existing] = await query(
              sql`SELECT id,role FROM users WHERE lower(email)=${row.email}`,
              tx,
            );
            if (existing && existing.role !== "STUDENT")
              throw new HttpError(409, "Account changed during import.");
            const userId = existing?.id ?? randomUUID();
            if (!existing)
              await tx.execute(
                sql`INSERT INTO users(id,email,name,password_hash,role,created_by) VALUES(${userId},${row.email},${row.name},${password},'STUDENT',${u.id})`,
              );
            const [mapped] = await query(
              sql`SELECT user_id FROM lms_users WHERE external_id=${row.externalId}`,
              tx,
            );
            if (mapped && mapped.user_id !== userId)
              throw new HttpError(
                409,
                "Identity mapping changed during import.",
              );
            await tx.execute(
              sql`INSERT INTO lms_users(external_id,user_id) VALUES(${row.externalId},${userId}) ON CONFLICT(external_id) DO NOTHING`,
            );
            await tx.execute(
              sql`INSERT INTO enrollments(course_id,user_id) VALUES(${run.preview.courseId},${userId}) ON CONFLICT DO NOTHING`,
            );
          }
          await audit(tx, {
            userId: u.id,
            type: "LMS_ROSTER_SYNCED",
            metadata: { runId: id, count: run.preview.entries.length },
          });
          await tx.execute(
            sql`UPDATE integration_runs SET status='COMPLETE',result=${JSON.stringify([{ ok: true, count: run.preview.entries.length }])}::jsonb,updated_at=now() WHERE id=${id}`,
          );
        });
        return { ok: true };
      }
      // Each update is an absolute percentage, so rerunning a preview is safe after a partial failure.
      for (const row of run.preview.entries) {
        if (row.skip) {
          results.push({ name: row.name, status: "SKIPPED", reason: row.skip });
          continue;
        }
        try {
          const [current] = await query(
            sql`SELECT a.score,a.status,e.results_released FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=${row.id}`,
          );
          if (
            !current?.results_released ||
            current.status === "ACTIVE" ||
            Number(current.score) !== Number(row.score) ||
            current.score === null
          )
            throw new HttpError(
              409,
              "Grade changed or results withdrawn. Preview again.",
            );
          await canvasFetch(
            `/api/v1/courses/${run.preview.externalCourseId}/assignments/${run.preview.assignmentId}/submissions/${row.external_id}`,
            {
              method: "PUT",
              body: JSON.stringify({
                submission: { posted_grade: row.percent.toFixed(4) + "%" },
              }),
            },
          );
          results.push({ name: row.name, status: "SYNCED" });
        } catch (e) {
          results.push({
            name: row.name,
            status: "FAILED",
            reason: e instanceof HttpError ? e.message : "Sync failed",
          });
        }
        await query(
          sql`UPDATE integration_runs SET result=${JSON.stringify(results)}::jsonb,updated_at=now() WHERE id=${id}`,
        );
      }
      const status = results.some(
        (r) => r.status === "FAILED" || r.status === "SKIPPED",
      )
        ? "PARTIAL"
        : "COMPLETE";
      await query(
        sql`UPDATE integration_runs SET status=${status},result=${JSON.stringify(results)}::jsonb,updated_at=now() WHERE id=${id}`,
      );
      await record({
        userId: u.id,
        type: "LMS_GRADES_SYNCED",
        metadata: { runId: id, status },
      });
      return { status, results };
    } catch (e) {
      await query(
        sql`UPDATE integration_runs SET status='FAILED',result=${JSON.stringify([{ status: "FAILED", reason: "Sync failed. Check mappings and preview again." }])}::jsonb,updated_at=now() WHERE id=${id}`,
      );
      throw e;
    }
  }
  throw new HttpError(404, "Integration action not found.");
}
function canonical(v: any): string {
  return JSON.stringify(v, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
}
