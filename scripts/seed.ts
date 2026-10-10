import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { sql } from "drizzle-orm";
import { db, query } from "../src/lib/db";
import { policySchema } from "../src/lib/domain";
if (process.env.NODE_ENV === "production" || process.env.VERCEL)
  throw new Error("Demo seed is disabled in production.");
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 16)
  throw new Error("Set a private SEED_PASSWORD of 16+ characters in .env.");
if ((await query(sql`SELECT id FROM users LIMIT 1`)).length) {
  console.log("Database already contains users. Seed skipped.");
  process.exit(0);
}
const teacher = randomUUID(),
  course = randomUUID(),
  room = randomUUID(),
  strict = randomUUID(),
  practice = randomUUID();
const passwordHash = await hash(password, 12);
await db.transaction(async (tx) => {
  await tx.execute(
    sql`INSERT INTO users(id,email,name,password_hash,role) VALUES(${teacher},'teacher@example.test','Professor Karmakar',${passwordHash},'ADMIN')`,
  );
  await tx.execute(
    sql`INSERT INTO courses(id,teacher_id,code,name,section) VALUES(${course},${teacher},'CS301','Data Structures & Algorithms','Section 01')`,
  );
  for (const [i, name] of [
    "Ananya Srisuk",
    "Nattapong Chai",
    "Maya Chen",
    "Pimchanok Wong",
    "Daniel Kim",
    "Arisa Kittisak",
  ].entries()) {
    const id = randomUUID();
    await tx.execute(
      sql`INSERT INTO users(id,email,name,password_hash,role,student_id,section,created_by) VALUES(${id},${"student" + (i + 1) + "@example.test"},${name},${passwordHash},'STUDENT',${"6601000" + (i + 1)},'Section 01',${teacher})`,
    );
    await tx.execute(
      sql`INSERT INTO enrollments(course_id,user_id) VALUES(${course},${id})`,
    );
  }
  const classroom = {
    name: "Innovation Lab · A4-301",
    building: "A4",
    floor: "3",
    room: "301",
    latitude: 14.039,
    longitude: 100.615,
    radius: 150,
    accuracy: 60,
  };
  await tx.execute(
    sql`INSERT INTO classrooms(id,teacher_id,name,configuration) VALUES(${room},${teacher},${classroom.name},${JSON.stringify(classroom)}::jsonb)`,
  );
  const policies = [
    policySchema.parse({ randomize: true, shuffleOptions: true }),
    policySchema.parse({
      camera: false,
      microphone: false,
      location: false,
      fullscreen: false,
      classroomCode: false,
      allowMobile: true,
      allowCopy: true,
      allowPaste: true,
    }),
  ];
  for (const [i, id] of [strict, practice].entries())
    await tx.execute(
      sql`INSERT INTO exams(id,course_id,title,instructions,status,starts_at,ends_at,duration_minutes,policy,classroom,code_secret) VALUES(${id},${course},${i ? "Algorithms · Practice quiz" : "Data Structures · Midterm"},'Read each question carefully. Save your responses in the examination workspace. Contact your instructor if a technical issue occurs.',${i ? "PUBLISHED" : "DRAFT"},now()-interval '1 hour',now()+interval '30 days',90,${JSON.stringify(policies[i])}::jsonb,${JSON.stringify(classroom)}::jsonb,${randomUUID()})`,
    );
  const questions = [
    {
      type: "MCQ",
      prompt:
        "What is the worst-case time complexity of binary search on a sorted array of $n$ elements?",
      options: ["O(1)", "O(log n)", "O(n)", "O(n²)"],
      solution: "O(log n)",
      marks: 5,
    },
    {
      type: "MULTI_SELECT",
      prompt:
        "Which of the following are **linear data structures**? Select all that apply.",
      options: ["Array", "Linked list", "Binary tree", "Stack"],
      solution: ["Array", "Linked list", "Stack"],
      marks: 5,
    },
    {
      type: "NUMERIC",
      prompt:
        "A complete binary tree has 15 nodes. How many levels does it have, counting the root as level 1?",
      options: [],
      solution: "4",
      marks: 5,
    },
    {
      type: "CODING",
      prompt:
        "Write a Python function `is_balanced(text)` that checks whether the parentheses in a string are balanced. Explain your time complexity in a comment.",
      options: [],
      solution: null,
      marks: 10,
    },
    {
      type: "ESSAY",
      prompt:
        "Compare a hash table and a balanced binary search tree. Give one scenario where each would be the better choice.",
      options: [],
      solution: null,
      marks: 10,
    },
  ];
  for (const [position, q] of questions.entries()) {
    const id = randomUUID();
    await tx.execute(
      sql`INSERT INTO questions(id,teacher_id,type,prompt,marks,options,solution,rubric,topic) VALUES(${id},${teacher},${q.type},${q.prompt},${q.marks},${JSON.stringify(q.options)}::jsonb,${JSON.stringify(q.solution)}::jsonb,'Award marks for correctness, explanation and complexity analysis.','Data structures')`,
    );
    for (const exam of [strict, practice])
      await tx.execute(
        sql`INSERT INTO exam_questions(exam_id,question_id,position) VALUES(${exam},${id},${position})`,
      );
  }
});
console.log(
  "Development seed complete. Accounts: teacher@example.test and student1@example.test through student6@example.test. Password is your private SEED_PASSWORD.",
);
process.exit(0);
