import { setTimeout as sleep } from "node:timers/promises";
import type { CvDraft, Llm } from "./llm.js";

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

export function createFakeLlm(delayMs: number): Llm {
  return {
    async draft(input) {
      await sleep(delayMs);
      return fakeDraft(input);
    },
  };
}
