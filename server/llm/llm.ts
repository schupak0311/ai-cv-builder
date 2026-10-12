import { z } from "zod";
import { CvSection, type Cv } from "../../shared/cv.js";

const Evidence = z.array(z.string());
const EvidencedText = z.object({ text: z.string(), evidence: Evidence });

export const CvDraft = z.object({
  contact: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    links: z.array(z.string()),
  }),
  summary: z.array(EvidencedText),
  experience: z.array(
    z.object({
      employer: z.string().nullable(),
      title: z.string().nullable(),
      location: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      bullets: z.array(EvidencedText),
      evidence: Evidence,
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string().nullable(),
      degree: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      evidence: Evidence,
    }),
  ),
  skills: z.array(z.string()),
  questions: z.array(z.object({ section: CvSection, text: z.string() })),
});
export type CvDraft = z.infer<typeof CvDraft>;

export type DraftQuestion = CvDraft["questions"][number];

export type AnsweredQuestion = { section: CvSection; text: string; answer: string };

/** Asks for a rewrite of `section` only, using the Source, every Answer, and the section's current content. */
export type ReviseInput = {
  targetRole: string;
  source: string;
  section: CvSection;
  content: Cv;
  answered: AnsweredQuestion[];
};

export interface Llm {
  draft(input: { targetRole: string; source: string }): Promise<CvDraft>;
  revise(input: ReviseInput): Promise<CvDraft>;
}

/** An error whose message is safe to show the user. `retryable` marks transient failures. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export function draftToCv(draft: CvDraft): { content: Cv; questions: DraftQuestion[] } {
  return {
    content: {
      contact: draft.contact,
      summary: draft.summary.map((s) => s.text).join(" "),
      experience: draft.experience.map((item, i) => ({
        id: `exp-${i + 1}`,
        employer: item.employer,
        title: item.title,
        location: item.location,
        start: item.start,
        end: item.end,
        bullets: item.bullets.map((b) => b.text),
      })),
      education: draft.education.map((item, i) => ({
        id: `edu-${i + 1}`,
        institution: item.institution,
        degree: item.degree,
        start: item.start,
        end: item.end,
      })),
      skills: draft.skills,
    },
    questions: draft.questions,
  };
}
