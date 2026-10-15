import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, query } from "./db";
import { HttpError, type Actor } from "./auth";
import { audit } from "./audit";
import { uuid } from "./validation";
import { ownedExam } from "./exams";
import { integrationRequest } from "./university-integrations";

const note = z.string().trim().min(10).max(4000);
const staff = (u: Actor) => {
  if (u.role === "STUDENT")
    throw new HttpError(403, "Instructor access required.");
};
export async function growthRequest(
  req: Request,
  parts: string[],
  u: Actor,
  body: () => Promise<any>,
) {
  const [resource, id, action] = parts;
  const read = req.method === "GET";
  if (!read && req.method !== "POST")
    throw new HttpError(405, "Use GET or POST.");
  if (resource === "integrations")
    return integrationRequest(req, parts.slice(1), u, body);
  if (resource === "practice") {
    if (read) {
      const [saved] = await query(
        sql`SELECT answer,version,checks,updated_at FROM practice_sessions WHERE user_id=${u.id}`,
      );
      return { saved: saved ?? null, serverTime: new Date().toISOString() };
    }
    const v = z
      .object({
        answer: z.object({
          choice: z.enum(["", "4", "5", "6"]),
          reflection: z.string().max(3000),
        }),
        version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        checks: z
          .record(z.string().max(40), z.enum(["PASS", "FAIL", "NOT_TESTED"]))
          .default({}),
      })
      .parse(await body());
    const [saved] = await query(
      sql`INSERT INTO practice_sessions(user_id,answer,version,checks) VALUES(${u.id},${JSON.stringify(v.answer)}::jsonb,${v.version},${JSON.stringify(v.checks)}::jsonb) ON CONFLICT(user_id) DO UPDATE SET answer=EXCLUDED.answer,version=EXCLUDED.version,checks=EXCLUDED.checks,updated_at=now() WHERE practice_sessions.version<EXCLUDED.version RETURNING answer,version,updated_at`,
    );
    if (!saved)
      throw new HttpError(
        409,
        "A newer practice save exists. Reload before saving again.",
      );
    return { saved };
  }
  if (resource === "requests") {
    if (read) {
      if (u.role === "STUDENT") {
        if (!id) throw new HttpError(400, "Attempt ID required.");
        const attemptId = uuid.parse(id);
        const [request] = await query(
          sql`SELECT id,status,message,created_at,reviewed_at FROM reentry_requests WHERE attempt_id=${attemptId} AND user_id=${u.id} ORDER BY created_at DESC LIMIT 1`,
        );
        if (request) return { reentryRequest: request };
        const [lastReentry] = await query(
          sql`SELECT ev.event_type,ev.created_at FROM audit_events ev JOIN attempts a ON a.id=ev.attempt_id WHERE ev.attempt_id=${attemptId} AND a.user_id=${u.id} AND ev.event_type IN('ADMIN_reentry','SESSION_RECOVERED') ORDER BY ev.sequence DESC LIMIT 1`,
        );
        return {
          reentryRequest:
            lastReentry?.event_type === "ADMIN_reentry"
              ? {
                  id: null,
                  status: "APPROVED",
                  message: "",
                  created_at: lastReentry.created_at,
                  reviewed_at: lastReentry.created_at,
                }
              : null,
        };
      }
      if (id) throw new HttpError(404, "Request endpoint not found.");
      const [entryRequests, reentryRequests] = await Promise.all([
        query(
          sql`SELECT k.exam_id,u.id AS user_id,u.name,u.student_id,u.email,k.created_at AS requested_at,e.title AS exam_title,c.id AS course_id,c.code AS course_code,c.name AS course_name,c.section,'ENTRY' AS request_type FROM checkins k JOIN users u ON u.id=k.user_id JOIN exams e ON e.id=k.exam_id JOIN courses c ON c.id=e.course_id WHERE k.approved=false AND e.deleted_at IS NULL AND e.ends_at>now() AND e.status IN('PUBLISHED','LIVE','PAUSED','SCHEDULED') AND (${u.role === "ADMIN"} OR c.teacher_id=${u.id}) ORDER BY k.created_at`,
        ),
        query(
          sql`SELECT r.id,r.attempt_id,r.exam_id,r.user_id,r.message,r.created_at AS requested_at,u.name,u.student_id,u.email,e.title AS exam_title,c.id AS course_id,c.code AS course_code,c.name AS course_name,c.section,'REENTRY' AS request_type FROM reentry_requests r JOIN users u ON u.id=r.user_id JOIN exams e ON e.id=r.exam_id JOIN courses c ON c.id=r.course_id JOIN attempts a ON a.id=r.attempt_id WHERE r.status='PENDING' AND a.status='ACTIVE' AND e.deleted_at IS NULL AND e.ends_at>now() AND (${u.role === "ADMIN"} OR c.teacher_id=${u.id}) ORDER BY r.created_at`,
        ),
      ]);
      return { entryRequests, reentryRequests };
    }

    if (!id) {
      if (u.role !== "STUDENT")
        throw new HttpError(403, "Student access required.");
      const v = z
        .object({
          attemptId: uuid,
          message: z.string().trim().max(500).default(""),
        })
        .parse(await body());
      return db.transaction(async (tx) => {
        const [attempt] = await query(
          sql`SELECT a.id,a.exam_id,a.status,e.course_id,e.status AS exam_status,e.ends_at FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN enrollments n ON n.course_id=e.course_id AND n.user_id=a.user_id WHERE a.id=${v.attemptId} AND a.user_id=${u.id} FOR UPDATE OF a`,
          tx,
        );
        if (!attempt)
          throw new HttpError(404, "Active exam attempt not found.");
        if (
          attempt.status !== "ACTIVE" ||
          !["PUBLISHED", "LIVE", "PAUSED"].includes(attempt.exam_status) ||
          new Date(attempt.ends_at).getTime() <= Date.now()
        )
          throw new HttpError(
            409,
            "This exam is no longer open for a re-entry request.",
          );
        const [pending] = await query(
          sql`SELECT id,status,message,created_at,reviewed_at FROM reentry_requests WHERE attempt_id=${attempt.id} AND status='PENDING'`,
          tx,
        );
        if (pending) return { reentryRequest: pending };
        const requestId = randomUUID();
        await tx.execute(
          sql`INSERT INTO reentry_requests(id,attempt_id,exam_id,course_id,user_id,message) VALUES(${requestId},${attempt.id},${attempt.exam_id},${attempt.course_id},${u.id},${v.message})`,
        );
        await audit(tx, {
          userId: u.id,
          examId: attempt.exam_id,
          attemptId: attempt.id,
          type: "REENTRY_REQUESTED",
          metadata: { requestId, message: v.message },
        });
        const [request] = await query(
          sql`SELECT id,status,message,created_at,reviewed_at FROM reentry_requests WHERE id=${requestId}`,
          tx,
        );
        return { reentryRequest: request };
      });
    }

    staff(u);
    const requestId = uuid.parse(id);
    if (action !== "approve" && action !== "decline")
      throw new HttpError(404, "Request action not found.");
    return db.transaction(async (tx) => {
      const [request] = await query(
        sql`SELECT r.*,a.status AS attempt_status FROM reentry_requests r JOIN attempts a ON a.id=r.attempt_id WHERE r.id=${requestId} FOR UPDATE OF r,a`,
        tx,
      );
      if (!request) throw new HttpError(404, "Re-entry request not found.");
      await ownedExam(request.exam_id, u, tx);
      if (request.status !== "PENDING")
        throw new HttpError(409, "This request has already been reviewed.");
      const status = action === "approve" ? "APPROVED" : "DECLINED";
      if (action === "approve" && request.attempt_status !== "ACTIVE")
        throw new HttpError(
          409,
          "The student’s exam attempt is no longer active.",
        );
      await tx.execute(
        sql`UPDATE reentry_requests SET status=${status},reviewed_at=now(),reviewed_by=${u.id} WHERE id=${requestId}`,
      );
      if (action === "approve")
        await tx.execute(
          sql`UPDATE attempts SET device_session_id=${randomUUID()} WHERE id=${request.attempt_id}`,
        );
      await audit(tx, {
        userId: u.id,
        examId: request.exam_id,
        attemptId: request.attempt_id,
        type: action === "approve" ? "ADMIN_reentry" : "REENTRY_DECLINED",
        metadata: { requestId },
      });
      return { ok: true, status };
    });
  }
  if (resource === "learning" && read) {
    if (u.role !== "STUDENT")
      throw new HttpError(403, "Student access required.");
    const attempts = await query(
      sql`SELECT a.id,e.title,c.code,a.score,a.feedback,a.submitted_at,(SELECT sum(q.marks) FROM questions q WHERE q.id IN(SELECT jsonb_array_elements_text(a.question_order)::uuid)) AS maximum FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id WHERE a.user_id=${u.id} AND a.status<>'ACTIVE' AND e.results_released=true ORDER BY a.submitted_at`,
    );
    const responses = await query(
      sql`SELECT an.attempt_id,q.topic,q.prompt,an.mark,q.marks,an.feedback FROM answers an JOIN questions q ON q.id=an.question_id JOIN attempts a ON a.id=an.attempt_id JOIN exams e ON e.id=a.exam_id WHERE a.user_id=${u.id} AND a.status<>'ACTIVE' AND e.results_released=true ORDER BY a.submitted_at,q.topic,q.id`,
    );
    const topics = new Map<
      string,
      { topic: string; earned: number; possible: number; count: number }
    >();
    for (const r of responses) {
      if (r.mark === null) continue;
      const key = r.topic || "Uncategorized";
      const t = topics.get(key) ?? {
        topic: key,
        earned: 0,
        possible: 0,
        count: 0,
      };
      t.earned += Number(r.mark);
      t.possible += Number(r.marks);
      t.count++;
      topics.set(key, t);
    }
    return { attempts, responses, topics: [...topics.values()] };
  }
  if (resource === "submissions" && read) {
    staff(u);
    if (id) {
      const examId = uuid.parse(id);
      await ownedExam(examId, u);
      const rows = await query(
        sql`SELECT a.id AS attempt_id,a.status AS attempt_status,a.started_at,a.submitted_at,a.warnings,a.location_status,a.score,e.title AS exam_title,u.name AS student_name,u.student_id,u.email,c.code AS course_code,c.name AS course_name,c.section,ordered.position,q.id AS question_id,q.type,q.prompt,q.marks,q.options AS default_options,COALESCE(a.option_order->q.id::text,q.options) AS options,an.value,an.mark,an.feedback,(SELECT f.name FROM files f WHERE f.attempt_id=a.id AND f.owner_id=a.user_id AND f.name LIKE 'SUBMISSION::%' ORDER BY f.created_at DESC LIMIT 1) AS document_submission_name FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id JOIN users u ON u.id=a.user_id JOIN LATERAL jsonb_array_elements_text(a.question_order) WITH ORDINALITY AS ordered(question_id,position) ON TRUE JOIN questions q ON q.id=ordered.question_id::uuid LEFT JOIN answers an ON an.attempt_id=a.id AND an.question_id=q.id WHERE a.exam_id=${examId} AND a.submitted_at IS NOT NULL ORDER BY u.name,a.submitted_at,ordered.position`,
      );
      const submissions = new Map<string, any>();
      for (const row of rows) {
        const submission = submissions.get(row.attempt_id) ?? {
          attempt_id: row.attempt_id,
          attempt_status: row.attempt_status,
          started_at: row.started_at,
          submitted_at: row.submitted_at,
          warnings: row.warnings,
          location_status: row.location_status,
          score: row.score,
          exam_title: row.exam_title,
          student_name: row.student_name,
          student_id: row.student_id,
          email: row.email,
          course_code: row.course_code,
          course_name: row.course_name,
          section: row.section,
          document_submission_name: row.document_submission_name,
          questions: [],
        };
        submission.questions.push({
          id: row.question_id,
          type: row.type,
          prompt: row.prompt,
          marks: row.marks,
          options: row.options ?? row.default_options,
          value: row.value,
          mark: row.mark,
          feedback: row.feedback,
        });
        submissions.set(row.attempt_id, submission);
      }
      return [...submissions.values()];
    }
    return query(
      sql`SELECT a.id AS attempt_id,a.exam_id,e.title AS exam_title,e.status AS exam_status,a.status AS attempt_status,a.submitted_at,a.started_at,a.score,u.name AS student_name,u.student_id,u.email,c.code AS course_code,c.name AS course_name,c.section,(SELECT count(*)::int FROM answers an WHERE an.attempt_id=a.id) AS answered,(SELECT count(*)::int FROM questions q WHERE q.id IN(SELECT jsonb_array_elements_text(a.question_order)::uuid)) AS question_count,EXISTS(SELECT 1 FROM files f WHERE f.attempt_id=a.id AND f.owner_id=a.user_id AND f.name LIKE 'SUBMISSION::%') AS has_document FROM attempts a JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id JOIN users u ON u.id=a.user_id WHERE a.submitted_at IS NOT NULL AND e.deleted_at IS NULL AND (${u.role === "ADMIN"} OR c.teacher_id=${u.id}) ORDER BY c.code,c.section,e.title,a.submitted_at DESC,u.name`,
    );
  }
  if (resource === "actions") {
    staff(u);
    if (!read) {
      const v = z.object({ eventId: uuid, note }).parse(await body());
      await db.transaction(async (tx) => {
        const [ev] = await query(
          sql`SELECT * FROM audit_events WHERE id=${v.eventId} AND event_type='WARNING_ISSUED'`,
          tx,
        );
        if (!ev) throw new HttpError(404, "Warning event not found.");
        await ownedExam(ev.exam_id, u, tx);
        const inserted = await query(
          sql`INSERT INTO incident_reviews(event_id,reviewer_id,note) VALUES(${v.eventId},${u.id},${v.note}) ON CONFLICT DO NOTHING RETURNING event_id`,
          tx,
        );
        if (!inserted.length)
          throw new HttpError(409, "This event has already been reviewed.");
        await audit(tx, {
          userId: u.id,
          examId: ev.exam_id,
          attemptId: ev.attempt_id,
          type: "INCIDENT_REVIEWED",
          metadata: v,
        });
      });
      return { ok: true };
    }
    const pending = await query(
      sql`SELECT k.exam_id,k.user_id,k.created_at,u.name,e.title FROM checkins k JOIN users u ON u.id=k.user_id JOIN exams e ON e.id=k.exam_id JOIN courses c ON c.id=e.course_id WHERE k.approved=false AND e.ends_at>now() AND e.status IN('PUBLISHED','LIVE','PAUSED','SCHEDULED') AND (${u.role === "ADMIN"} OR c.teacher_id=${u.id}) ORDER BY k.created_at`,
    );
    const disconnected = await query(
      sql`SELECT a.id,a.exam_id,a.last_heartbeat_at,u.name,e.title FROM attempts a JOIN users u ON u.id=a.user_id JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id WHERE a.status='ACTIVE' AND a.deadline>now() AND a.last_heartbeat_at<now()-interval '90 seconds' AND (${u.role === "ADMIN"} OR c.teacher_id=${u.id}) ORDER BY a.last_heartbeat_at`,
    );
    const incidents = await query(
      sql`SELECT ev.id,ev.attempt_id,ev.exam_id,ev.created_at,ev.severity,ev.metadata,
                 a.user_id,u.name,u.student_id,e.title,c.code AS course_code,c.section,
                 (r.event_id IS NOT NULL) AS reviewed,
                 wea.folder_id AS drive_folder_id,wea.report_id AS drive_report_id,
                 evidence.url AS evidence_url
          FROM audit_events ev
          JOIN attempts a ON a.id=ev.attempt_id
          JOIN users u ON u.id=a.user_id
          JOIN exams e ON e.id=ev.exam_id
          JOIN courses c ON c.id=e.course_id
          LEFT JOIN incident_reviews r ON r.event_id=ev.id
          LEFT JOIN warning_evidence_archives wea ON wea.attempt_id=a.id
          LEFT JOIN files evidence ON evidence.id::text=ev.metadata->>'evidenceFileId' AND evidence.attempt_id=a.id
          WHERE ev.event_type='WARNING_ISSUED'
            AND EXISTS(SELECT 1 FROM audit_events pending
              LEFT JOIN incident_reviews pending_review ON pending_review.event_id=pending.id
              WHERE pending.attempt_id=a.id AND pending.event_type='WARNING_ISSUED'
                AND pending_review.event_id IS NULL)
            AND (${u.role === "ADMIN"} OR c.teacher_id=${u.id})
          ORDER BY ev.created_at DESC LIMIT 500`,
    );
    const [appeals] = await query(
      sql`SELECT count(*)::int AS count FROM appeals p JOIN attempts a ON a.id=p.attempt_id JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id WHERE p.status IN('OPEN','UNDER_REVIEW') AND (${u.role === "ADMIN"} OR c.teacher_id=${u.id})`,
    );
    return {
      pending,
      disconnected,
      incidents,
      appeals: appeals.count,
      serverTime: new Date().toISOString(),
    };
  }
  if (resource === "appeals") {
    if (read) {
      const cases = await query(
        sql`SELECT p.*,e.title,u.name,ev.event_type,ev.created_at AS event_at FROM appeals p JOIN attempts a ON a.id=p.attempt_id JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id JOIN users u ON u.id=p.user_id JOIN audit_events ev ON ev.id=p.event_id WHERE (${u.role === "STUDENT"} AND p.user_id=${u.id}) OR (${u.role === "ADMIN"}) OR (${u.role === "TEACHER"} AND c.teacher_id=${u.id}) ORDER BY p.updated_at DESC`,
      );
      const messages = await query(
        sql`SELECT m.*,u.name FROM appeal_messages m JOIN users u ON u.id=m.author_id WHERE m.appeal_id IN(SELECT p.id FROM appeals p JOIN attempts a ON a.id=p.attempt_id JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id WHERE (${u.role === "STUDENT"} AND p.user_id=${u.id}) OR (${u.role === "ADMIN"}) OR (${u.role === "TEACHER"} AND c.teacher_id=${u.id})) ORDER BY m.created_at,m.id`,
      );
      const events =
        u.role === "STUDENT"
          ? await query(
              sql`SELECT ev.id,ev.event_type,ev.severity,ev.created_at,e.title FROM audit_events ev JOIN attempts a ON a.id=ev.attempt_id JOIN exams e ON e.id=a.exam_id WHERE a.user_id=${u.id} AND ev.event_type='WARNING_ISSUED' AND NOT EXISTS(SELECT 1 FROM appeals p WHERE p.event_id=ev.id) ORDER BY ev.created_at DESC`,
            )
          : [];
      return { cases, messages, events };
    }
    if (!id) {
      if (u.role !== "STUDENT")
        throw new HttpError(403, "Students submit their own appeals.");
      const v = z.object({ eventId: uuid, message: note }).parse(await body());
      return db.transaction(async (tx) => {
        const [ev] = await query(
          sql`SELECT ev.* FROM audit_events ev JOIN attempts a ON a.id=ev.attempt_id WHERE ev.id=${v.eventId} AND a.user_id=${u.id} AND ev.event_type='WARNING_ISSUED'`,
          tx,
        );
        if (!ev) throw new HttpError(404, "Warning event not found.");
        const caseId = randomUUID();
        await tx.execute(
          sql`INSERT INTO appeals(id,event_id,attempt_id,user_id) VALUES(${caseId},${ev.id},${ev.attempt_id},${u.id})`,
        );
        await tx.execute(
          sql`INSERT INTO appeal_messages(id,appeal_id,author_id,message,status) VALUES(${randomUUID()},${caseId},${u.id},${v.message},'OPEN')`,
        );
        await audit(tx, {
          userId: u.id,
          examId: ev.exam_id,
          attemptId: ev.attempt_id,
          type: "APPEAL_OPENED",
          metadata: { appealId: caseId },
        });
        return { id: caseId };
      });
    }
    uuid.parse(id);
    const v = z
      .object({
        version: z.number().int().positive(),
        status: z.enum(["UNDER_REVIEW", "UPHELD", "DISMISSED", "OPEN"]),
        message: note,
      })
      .parse(await body());
    if (action !== "update")
      throw new HttpError(404, "Appeal action not found.");
    return db.transaction(async (tx) => {
      const [p] = await query(
        sql`SELECT p.*,a.exam_id FROM appeals p JOIN attempts a ON a.id=p.attempt_id WHERE p.id=${id} FOR UPDATE OF p`,
        tx,
      );
      if (!p) throw new HttpError(404, "Appeal not found.");
      if (u.role === "STUDENT") {
        if (p.user_id !== u.id)
          throw new HttpError(403, "Appeal access denied.");
        if (
          v.status !== "OPEN" ||
          !["UPHELD", "DISMISSED"].includes(p.status) ||
          p.reopened
        )
          throw new HttpError(409, "A decided appeal can be reopened once.");
      } else {
        await ownedExam(p.exam_id, u, tx);
        if (!["OPEN", "UNDER_REVIEW"].includes(p.status) || v.status === "OPEN")
          throw new HttpError(
            409,
            "Only open appeals can be reviewed or decided.",
          );
      }
      if (p.version !== v.version)
        throw new HttpError(
          409,
          "This appeal changed. Refresh before continuing.",
        );
      await tx.execute(
        sql`UPDATE appeals SET status=${v.status},version=version+1,reopened=reopened OR ${u.role === "STUDENT"},updated_at=now() WHERE id=${id}`,
      );
      await tx.execute(
        sql`INSERT INTO appeal_messages(id,appeal_id,author_id,message,status) VALUES(${randomUUID()},${id},${u.id},${v.message},${v.status})`,
      );
      await audit(tx, {
        userId: u.id,
        examId: p.exam_id,
        attemptId: p.attempt_id,
        type: "APPEAL_" + v.status,
        metadata: { appealId: id, version: v.version + 1 },
      });
      return { ok: true };
    });
  }
  throw new HttpError(404, "Feature not found.");
}
