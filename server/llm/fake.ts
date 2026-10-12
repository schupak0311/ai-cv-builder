import { setTimeout as sleep } from "node:timers/promises";
import type { CvDraft, Llm, ReviseInput } from "./llm.js";

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d[\d ().-]{7,}\d/;
const URL_PATTERN = /https?:\/\/\S+/g;
const SKILLS_LINE = /^skills?\s*:\s*(.+)$/i;

/** Builds a draft whose every Claim quotes a Source line verbatim as its Evidence. */
export function fakeDraft({ targetRole, source }: { targetRole: string; source: string }): CvDraft {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const [first = ""] = lines;
  const name = first.length <= 60 && !EMAIL.test(first) && !PHONE.test(first) ? first : null;
  const skillsLine = lines.find((line) => SKILLS_LINE.test(line));
  const skills = (skillsLine?.match(SKILLS_LINE)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const prose = lines.filter(
    (line) =>
      line !== name &&
      line !== skillsLine &&
      !EMAIL.test(line) &&
      !PHONE.test(line) &&
      !line.match(URL_PATTERN),
  );
  const [summaryLine, ...bulletLines] = prose;
  const evidenced = (line: string) => ({ text: line, evidence: [line] });

  return {
    contact: {
      name,
      email: source.match(EMAIL)?.[0] ?? null,
      phone: source.match(PHONE)?.[0] ?? null,
      location: null,
      links: source.match(URL_PATTERN) ?? [],
    },
    summary: summaryLine === undefined ? [] : [evidenced(summaryLine)],
    experience:
      bulletLines.length === 0
        ? []
        : [
            {
              employer: null,
              title: null,
              location: null,
              start: null,
              end: null,
              bullets: bulletLines.slice(0, 8).map(evidenced),
              evidence: [],
            },
          ],
    education: [],
    skills,
    questions: [
      { section: "summary", text: `What makes you a strong fit for the ${targetRole} role?` },
    ],
  };
}

const EMPTY_DRAFT: CvDraft = {
  contact: { name: null, email: null, phone: null, location: null, links: [] },
  summary: [],
  experience: [],
  education: [],
  skills: [],
  questions: [],
};

/**
 * Appends each summary Answer the current summary lacks, each sentence quoting itself as Evidence.
 * Other sections come back empty, which the worker treats as "keep the current section".
 */
export function fakeRevise({ section, content, answered }: ReviseInput): CvDraft {
  if (section !== "summary") return EMPTY_DRAFT;
  const added = answered.filter((q) => q.section === "summary" && !content.summary.includes(q.answer));
  const sentences = [content.summary, ...added.map((q) => q.answer)]
    .filter((text) => text.length > 0)
    .map((text) => ({ text, evidence: [text] }));
  return { ...EMPTY_DRAFT, summary: sentences };
}

export function createFakeLlm(delayMs: number): Llm {
  return {
    async draft(input) {
      await sleep(delayMs);
      return fakeDraft(input);
    },
    async revise(input) {
      await sleep(delayMs);
      return fakeRevise(input);
    },
  };
}
