import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, query, type Tx } from "./db";
import { audit } from "./audit";
import {
  examFullscreenRequired,
  examScreenSharingRequired,
} from "./exam-device";
import { HttpError, type Actor } from "./auth";
import {
  validClassroomCode,
  deadline,
  geofence,
  grade,
  policySchema,
  shuffled,
  warningDecision,
  locationSchema,
} from "./domain";
export async function ownedExam(id: string, u: Actor, tx?: Tx) {
  const [e] = await query(
    sql`SELECT e.*,c.teacher_id,c.code AS course_code,c.name AS course_name,c.section AS course_section FROM exams e JOIN courses c ON c.id=e.course_id WHERE e.id=${id} AND e.deleted_at IS NULL`,
    tx,
  );
  if (!e) throw new HttpError(404, "Exam not found.");
  if (u.role !== "ADMIN" && e.teacher_id !== u.id)
    throw new HttpError(403, "This examination belongs to another teacher.");
  return e;
}
export async function enrolledExam(id: string, u: Actor, tx?: Tx) {
  const [e] = await query(
    sql`SELECT e.*,c.code AS course_code,c.name AS course_name FROM exams e JOIN courses c ON c.id=e.course_id JOIN enrollments n ON n.course_id=e.course_id WHERE e.id=${id} AND e.deleted_at IS NULL AND n.user_id=${u.id} AND n.eligible=true`,
    tx,
  );
  if (!e) throw new HttpError(403, "You are not eligible for this exam.");
  return e;
}
export async function finish(
  tx: Tx,
  a: Record<string, any>,
  status: string,
  userId: string,
) {
  if (a.status !== "ACTIVE") return;
  await tx.execute(
    sql`UPDATE attempts SET status=${status},submitted_at=now() WHERE id=${a.id}`,
  );
  await tx.execute(
    sql`DELETE FROM screen_share_sessions WHERE attempt_id=${a.id}`,
  );
  const qs = await query(
    sql`SELECT q.*,an.value FROM questions q LEFT JOIN answers an ON an.question_id=q.id AND an.attempt_id=${a.id} WHERE q.id IN (SELECT jsonb_array_elements_text(question_order)::uuid FROM attempts WHERE id=${a.id})`,
    tx,
  );
  const [e] = await query(
    sql`SELECT policy FROM exams WHERE id=${a.exam_id}`,
    tx,
  );
  let total = 0,
    manual = false;
  for (const q of qs) {
    const mark = grade(
      q.type,
      q.value,
      q.solution,
      Number(q.marks),
      e.policy.negativeMarks,
    );
    if (mark === null) manual = true;
    else total += mark;
    await tx.execute(
      sql`INSERT INTO answers(attempt_id,question_id,value,mark) VALUES(${a.id},${q.id},${JSON.stringify(q.value ?? null)}::jsonb,${mark}) ON CONFLICT(attempt_id,question_id) DO UPDATE SET mark=${mark}`,
    );
  }
  await tx.execute(
    sql`UPDATE attempts SET score=${manual ? null : total} WHERE id=${a.id}`,
  );
  await audit(tx, {
    userId,
    examId: a.exam_id,
    attemptId: a.id,
    type: status,
    severity: status.includes("SECURITY") ? "HIGH" : "INFO",
    metadata: { objectiveScore: total, manualGradingRequired: manual },
  });
}
export async function lockedAttempt(
  id: string,
  u: Actor,
  tx: Tx,
  device?: string,
) {
  const [a] = await query(
    sql`SELECT * FROM attempts WHERE id=${id} FOR UPDATE`,
    tx,
  );
  if (!a) throw new HttpError(404, "Attempt not found.");
  if (u.role === "STUDENT") {
    if (a.user_id !== u.id) throw new HttpError(403, "Attempt access denied.");
    if (!device || a.device_session_id !== device)
      throw new HttpError(
        409,
        "This attempt is active in another browser session.",
      );
  } else await ownedExam(a.exam_id, u, tx);
  const [exam] = await query(
    sql`SELECT status FROM exams WHERE id=${a.exam_id}`,
    tx,
  );
  if (
    a.status === "ACTIVE" &&
    exam.status !== "PAUSED" &&
    new Date(a.deadline).getTime() <= Date.now()
  ) {
    await finish(tx, a, "AUTO_SUBMITTED_TIME", u.id);
    a.status = "AUTO_SUBMITTED_TIME";
  }
  return a;
}
export async function effectivePolicy(
  e: Record<string, any>,
  userId: string,
  tx?: Tx,
) {
  const [acc] = await query(
    sql`SELECT * FROM accommodations WHERE exam_id=${e.id} AND user_id=${userId}`,
    tx,
  );
  const p = policySchema.parse(e.policy);
  // Require full-screen sharing on laptops, where browsers expose reliable
  // display capture. Tablets use the browser's tablet typing mode instead.
  p.screen = true;
  if (acc?.camera_exempt) p.camera = false;
  if (acc?.microphone_exempt) p.microphone = false;
  return { policy: p, accommodation: acc };
}
export async function startAttempt(
  examId: string,
  u: Actor,
  input: Record<string, any>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id=${u.id} FOR UPDATE`);
    const [registered] = await query(
      sql`SELECT d.id FROM exam_devices d JOIN users u ON u.id=d.user_id WHERE d.id=${input.deviceSessionId} AND d.user_id=${u.id} AND d.session_version=u.session_version`,
      tx,
    );
    if (!registered)
      throw new HttpError(
        409,
        "Device session expired. Sign out and sign in again.",
      );
    const e = await enrolledExam(examId, u, tx);
    const [old] = await query(
      sql`SELECT * FROM attempts WHERE exam_id=${examId} AND user_id=${u.id}`,
      tx,
    );
    if (old) {
      if (old.device_session_id !== input.deviceSessionId)
        throw new HttpError(
          409,
          "An attempt already exists in another session. Ask your teacher for recovery.",
        );
      return { id: old.id };
    }
    const now = Date.now();
    if (
      !["LIVE", "PUBLISHED", "SCHEDULED"].includes(e.status) ||
      now < new Date(e.starts_at).getTime() ||
      now >= new Date(e.ends_at).getTime()
    )
      throw new HttpError(409, "Exam is not open.");
    const { policy: p, accommodation: acc } = await effectivePolicy(
      e,
      u.id,
      tx,
    );
    if (!u.name.trim() || !u.email.trim() || !u.student_id?.trim())
      throw new HttpError(
        400,
        "Complete your full name, student ID and email details before starting the exam.",
      );
    if (!input.accepted)
      throw new HttpError(400, "Accept the monitoring notice.");
    for (const k of ["camera", "microphone", "screen", "fullscreen"] as const)
      if (
        (k !== "fullscreen" ||
          examFullscreenRequired(p.fullscreen, input.deviceClass)) &&
        (k !== "screen" ||
          examScreenSharingRequired(p.screen, input.deviceClass)) &&
        p[k] &&
        !input.checks[k]
      )
        throw new HttpError(400, `Required ${k} check has not passed.`);
    if (!["laptop", "tablet"].includes(input.deviceClass))
      throw new HttpError(
        403,
        "This exam can only be taken on a laptop or tablet. Phones are not allowed.",
      );
    if (p.location) {
      if (!input.location || !e.classroom)
        throw new HttpError(400, "A valid classroom location is required.");
      const g = geofence(input.location, e.classroom);
      if (!g.acceptable)
        throw new HttpError(
          400,
          "Location accuracy is currently insufficient. Please improve location access and retry.",
        );
      if (!g.inside)
        throw new HttpError(
          400,
          "You are currently outside the authorized examination location. Please enter the assigned classroom and retry.",
        );
    }
    if (p.classroomCode && !validClassroomCode(e.code_secret, input.code))
      throw new HttpError(400, "Classroom code is incorrect or expired.");
    if (p.teacherApproval) {
      const [check] = await query(
        sql`SELECT approved FROM checkins WHERE exam_id=${examId} AND user_id=${u.id}`,
        tx,
      );
      if (!check?.approved)
        throw new HttpError(409, "Waiting for teacher approval.");
    }
    const active = await query(
      sql`SELECT id FROM attempts WHERE user_id=${u.id} AND status='ACTIVE'`,
      tx,
    );
    if (active.length)
      throw new HttpError(409, "Another examination attempt is active.");
    const qs = await query(
      sql`SELECT q.id,q.options FROM exam_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.exam_id=${examId} ORDER BY position`,
      tx,
    );
    if (!qs.length) {
      const [paper] = await query(
        sql`SELECT id FROM files WHERE exam_id=${examId} AND attempt_id IS NULL AND mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document' LIMIT 1`,
        tx,
      );
      if (!paper)
        throw new HttpError(
          400,
          "Exam has no questions or Word question paper.",
        );
    }
    const id = randomUUID();
    let order =
      p.randomize || p.poolSize
        ? shuffled(
            qs.map((q) => q.id),
            id,
          )
        : qs.map((q) => q.id);
    if (p.poolSize) order = order.slice(0, p.poolSize);
    const options = Object.fromEntries(
      qs.map((q) => [
        q.id,
        p.shuffleOptions ? shuffled(q.options, id + q.id) : q.options,
      ]),
    );
    const initialDeviceState = {
      camera: !!input.checks.camera,
      microphone: !!input.checks.microphone,
      screen: !!input.checks.screen,
      screenShareUnavailable: !!input.screenShareUnavailable,
      deviceClass: input.deviceClass,
      fullscreen: !!input.checks.fullscreen,
      online: true,
    };
    await tx.execute(
      sql`INSERT INTO attempts(id,exam_id,user_id,device_session_id,deadline,question_order,option_order,device_state) VALUES(${id},${examId},${u.id},${input.deviceSessionId},${deadline(now, e.duration_minutes + (acc?.extra_minutes ?? 0), e.ends_at).toISOString()},${JSON.stringify(order)}::jsonb,${JSON.stringify(options)}::jsonb,${JSON.stringify(initialDeviceState)}::jsonb)`,
    );
    await audit(tx, {
      userId: u.id,
      examId,
      attemptId: id,
      type: "EXAM_STARTED",
      metadata: {
        noticeAccepted: true,
        policy: p,
        deviceClass: input.deviceClass,
        location: input.location ?? null,
        checks: input.checks,
      },
    });
    return { id };
  });
}
export async function event(
  tx: Tx,
  a: Record<string, any>,
  u: Actor,
  type: string,
  metadata: Record<string, any>,
  clientEventId: string,
) {
  const inserted = await query(
    sql`INSERT INTO event_receipts(attempt_id,client_event_id) VALUES(${a.id},${clientEventId}) ON CONFLICT DO NOTHING RETURNING client_event_id`,
    tx,
  );
  if (!inserted.length || a.status !== "ACTIVE") return;
  const [e] = await query(sql`SELECT * FROM exams WHERE id=${a.exam_id}`, tx);
  if (e.status === "PAUSED") return;
  const { policy, accommodation } = await effectivePolicy(e, u.id, tx);
  // Tablet sessions do not use capture, so a stale or forged stop event must
  // never count as a screen-sharing warning for those attempts.
  if (a.device_state?.deviceClass === "tablet") policy.screen = false;
  let eventType = type;
  let meta = metadata;
  if (type === "LOCATION_CHECK") {
    if (!policy.location) return;
    if (
      a.last_location_at &&
      Date.now() - new Date(a.last_location_at).getTime() < 15000
    )
      return;
    const g = geofence(locationSchema.parse(metadata), e.classroom);
    const count = g.acceptable && g.clearlyOutside ? a.outside_count + 1 : 0;
    eventType = !g.acceptable
      ? "LOCATION_ACCURACY_LOW"
      : g.inside
        ? "LOCATION_CHECK_OK"
        : count >= 2
          ? "LOCATION_OUTSIDE_GEOFENCE"
          : "LOCATION_CONFIRMATION_PENDING";
    meta = { ...metadata, ...g, consecutiveReadings: count };
    await tx.execute(
      sql`UPDATE attempts SET outside_count=${count},location_status=${eventType},last_location_at=now() WHERE id=${a.id}`,
    );
  }
  let decision = warningDecision(a.warnings, eventType, policy);
  const debounced =
    a.last_warning_at &&
    Date.now() - new Date(a.last_warning_at).getTime() < 10000;
  if (debounced || accommodation?.warning_exempt)
    decision = { warnings: a.warnings, terminate: false };
  await audit(tx, {
    userId: u.id,
    examId: a.exam_id,
    attemptId: a.id,
    type: eventType,
    severity: decision.warnings > a.warnings ? "HIGH" : "INFO",
    metadata: {
      ...meta,
      warningSuppressed: !!debounced || !!accommodation?.warning_exempt,
    },
  });
  if (decision.warnings > a.warnings) {
    await tx.execute(
      sql`UPDATE attempts SET warnings=${decision.warnings},last_warning_at=now() WHERE id=${a.id}`,
    );
    await audit(tx, {
      userId: u.id,
      examId: a.exam_id,
      attemptId: a.id,
      type: "WARNING_ISSUED",
      severity: "HIGH",
      metadata: { count: decision.warnings, reason: eventType },
    });
    a.warnings = decision.warnings;
    a.last_warning_at = new Date();
  }
  if (decision.terminate) {
    await finish(tx, a, "AUTO_SUBMITTED_SECURITY", u.id);
    a.status = "AUTO_SUBMITTED_SECURITY";
  }
}
export async function saveAnswers(
  tx: Tx,
  a: Record<string, any>,
  values: { questionId: string; value: unknown; version: number }[],
) {
  if (a.status !== "ACTIVE") return;
  const accepted: { questionId: string; version: number }[] = [];
  for (const answer of values) {
    if (!a.question_order.includes(answer.questionId))
      throw new HttpError(400, "Question not assigned to this attempt.");
    const [question] = await query(
      sql`SELECT type FROM questions WHERE id=${answer.questionId}`,
      tx,
    );
    if (question.type === "FILE_UPLOAD" && answer.value) {
      if (
        typeof answer.value !== "string" ||
        !/^[0-9a-f-]{36}$/.test(answer.value)
      )
        throw new HttpError(400, "Invalid file response.");
      const [file] = await query(
        sql`SELECT id FROM files WHERE id=${answer.value} AND attempt_id=${a.id} AND owner_id=${a.user_id}`,
        tx,
      );
      if (!file)
        throw new HttpError(403, "File does not belong to this attempt.");
    }
    const changed = await query(
      sql`INSERT INTO answers(attempt_id,question_id,value,version) VALUES(${a.id},${answer.questionId},${JSON.stringify(answer.value)}::jsonb,${answer.version}) ON CONFLICT(attempt_id,question_id) DO UPDATE SET value=EXCLUDED.value,version=EXCLUDED.version,updated_at=now() WHERE answers.version<EXCLUDED.version RETURNING question_id`,
      tx,
    );
    if (changed.length)
      accepted.push({ questionId: answer.questionId, version: answer.version });
    if (changed.length)
      await tx.execute(
        sql`INSERT INTO answer_revisions(attempt_id,question_id,value,version) VALUES(${a.id},${answer.questionId},${JSON.stringify(answer.value)}::jsonb,${answer.version})`,
      );
  }
  if (accepted.length)
    await audit(tx, {
      userId: a.user_id,
      examId: a.exam_id,
      attemptId: a.id,
      type: "ANSWER_AUTOSAVED",
      metadata: { revisions: accepted },
    });
  await tx.execute(
    sql`UPDATE attempts SET revision=revision+1,last_heartbeat_at=now() WHERE id=${a.id}`,
  );
}
