import { z } from "zod";
import { Cv, CvSection } from "./cv.js";

export const Me = z.object({ id: z.string(), email: z.string() });
export type Me = z.infer<typeof Me>;

export const JobStatus = z.enum(["queued", "running", "done", "failed"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const CvSummary = z.object({
  id: z.string(),
  targetRole: z.string(),
  status: JobStatus.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CvSummary = z.infer<typeof CvSummary>;

export const JobKind = z.enum(["generate", "revise"]);
export type JobKind = z.infer<typeof JobKind>;

export const ActiveJob = z.object({
  id: z.string(),
  kind: JobKind,
  status: z.enum(["queued", "running"]),
  createdAt: z.string(),
});
export type ActiveJob = z.infer<typeof ActiveJob>;

export const CvDetail = z.object({
  id: z.string(),
  targetRole: z.string(),
  content: Cv.nullable(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  job: ActiveJob.nullable(),
  error: z.string().nullable(),
  questions: z.array(
    z.object({
      id: z.string(),
      section: CvSection,
      text: z.string(),
      answer: z.string().nullable(),
    }),
  ),
});
export type CvDetail = z.infer<typeof CvDetail>;

export const SOURCE_TEXT_MIN = 50;
export const SOURCE_TEXT_MAX = 20_000;
export const TARGET_ROLE_MIN = 2;
export const TARGET_ROLE_MAX = 120;
export const PDF_MAX_BYTES = 5 * 1024 * 1024;
export const PDF_MAX_PAGES = 10;
export const PDF_TEXT_MIN = 100;
export const ANSWER_MAX = 2_000;
export const ANSWERS_MAX = 8;

export const SavedCv = z.object({ version: z.number() });
export type SavedCv = z.infer<typeof SavedCv>;
