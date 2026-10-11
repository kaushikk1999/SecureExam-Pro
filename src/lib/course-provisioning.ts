import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { COURSE_CATALOG } from "./course-data";
import { db, query } from "./db";

export async function ensureDefaultCoursesForUser(user: {
  id: string;
  email: string;
  role: string;
}) {
  const ownerEmail =
    process.env.DEFAULT_COURSE_OWNER_EMAIL?.trim().toLowerCase();
  if (
    !ownerEmail ||
    user.email.toLowerCase() !== ownerEmail ||
    user.role === "STUDENT"
  )
    return;

  await db.transaction(async (tx) => {
    const [owner] = await query(
      sql`SELECT id FROM users WHERE id=${user.id} AND active=true FOR UPDATE`,
      tx,
    );
    if (!owner) return;

    const existing = await query<{ code: string; section: string }>(
      sql`SELECT code,section FROM courses WHERE teacher_id=${user.id}`,
      tx,
    );
    const known = new Set(
      existing.map((course) => `${course.code}:${course.section}`),
    );
    for (const course of COURSE_CATALOG) {
      for (const section of course.sections) {
        if (known.has(`${course.code}:${section}`)) continue;
        await tx.execute(
          sql`INSERT INTO courses(id,teacher_id,code,name,section) VALUES(${randomUUID()},${user.id},${course.code},${course.name},${section})`,
        );
      }
    }
  });
}
