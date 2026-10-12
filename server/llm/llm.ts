import { z } from "zod";
import { Cv, CV_EDIT_BULLET_MAX, CV_EDIT_LIST_MAX, CV_EDIT_SHORT_MAX, CV_EDIT_SUMMARY_MAX, CvSection } from "../../shared/cv.js";

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

const QUESTIONS_MAX = 8;

const short = (value: string | null) => (value !== null && value.length <= CV_EDIT_SHORT_MAX ? value : null);
const within = (values: string[], max: number) => values.filter((v) => v.length <= max).slice(0, CV_EDIT_LIST_MAX);

function summaryWithin(sentences: string[]): string {
  let summary = "";
  for (const sentence of sentences) {
    const next = summary === "" ? sentence : `${summary} ${sentence}`;
    if (next.length <= CV_EDIT_SUMMARY_MAX) summary = next;
  }
  return summary;
}

/** Holds the draft to the editor's limits: a value over its limit is dropped and a list is cut. */
export function draftToCv(draft: CvDraft): { content: Cv; questions: DraftQuestion[] } {
  const { name, email, phone, location, links } = draft.contact;
  const content = Cv.parse({
    contact: { name: short(name), email: short(email), phone: short(phone), location: short(location), links: within(links, CV_EDIT_SHORT_MAX) },
    summary: summaryWithin(draft.summary.map((s) => s.text)),
    experience: draft.experience.slice(0, CV_EDIT_LIST_MAX).map((item, i) => ({
      id: `exp-${i + 1}`,
      employer: short(item.employer),
      title: short(item.title),
      location: short(item.location),
      start: short(item.start),
      end: short(item.end),
      bullets: within(
        item.bullets.map((b) => b.text),
        CV_EDIT_BULLET_MAX,
      ),
    })),
    education: draft.education.slice(0, CV_EDIT_LIST_MAX).map((item, i) => ({
      id: `edu-${i + 1}`,
      institution: short(item.institution),
      degree: short(item.degree),
      start: short(item.start),
      end: short(item.end),
    })),
    skills: within(draft.skills, CV_EDIT_SHORT_MAX),
  });
  return { content, questions: draft.questions.slice(0, QUESTIONS_MAX) };
}
