import { z } from "zod";
import { classroomSchema, policySchema, locationSchema } from "./domain";
export const uuid = z.string().uuid();
export const questionSchema = z.object({
  type: z.enum([
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
  ]),
  prompt: z.string().min(1).max(30000),
  marks: z.coerce.number().positive().max(1000),
  options: z.array(z.string().max(2000)).max(50).default([]),
  solution: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
    .default(null),
  rubric: z.string().max(10000).default(""),
  topic: z.string().max(120).default(""),
  difficulty: z.enum(["Easy", "Medium", "Hard"]).default("Medium"),
});
export const examSchema = z
  .object({
    courseId: uuid,
    title: z.string().min(1).max(180),
    instructions: z.string().max(30000).default(""),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    duration: z.coerce.number().int().min(1).max(600),
    passingScore: z.coerce.number().min(0).max(100).default(50),
    policy: policySchema,
    classroom: classroomSchema.nullable().default(null),
  })
  .refine(
    (v) => new Date(v.endsAt) > new Date(v.startsAt),
    "Closing time must be after opening time.",
  );
export const studentSchema = z.object({
  email: z.email().max(254),
  name: z.string().min(1).max(120),
  studentId: z.string().min(1).max(50),
  section: z.string().max(80).default(""),
  password: z.string().min(12).max(128),
  courseId: uuid.optional(),
});
export const answersSchema = z
  .array(
    z.object({
      questionId: uuid,
      value: z.union([
        z.string().max(100000),
        z.array(z.string().max(10000)).max(100),
        z.number(),
        z.boolean(),
        z.null(),
      ]),
      version: z.number().int().min(1).max(2147483646),
    }),
  )
  .max(200);
export const startSchema = z.object({
  deviceSessionId: uuid,
  deviceClass: z.enum(["laptop", "tablet", "phone", "unsupported"]),
  accepted: z.boolean(),
  aiCameraAccepted: z.boolean().default(false),
  code: z.string().max(6).default(""),
  checks: z.object({
    camera: z.boolean(),
    microphone: z.boolean(),
    screen: z.boolean(),
    fullscreen: z.boolean(),
  }),
  screenShareUnavailable: z.boolean().default(false),
  location: locationSchema.nullable().optional(),
});
