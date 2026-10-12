import type { Cv, CvSection } from "../../shared/cv.js";
import { checkDraft, countClaims } from "../factcheck/factcheck.js";
import { draftToCv, type CvDraft, type ReviseInput } from "../llm/llm.js";
import { currentSectionBlock } from "../llm/prompt.js";

/** `content` is null when nothing in the revised section survived the fact check. */
export type Revision = { content: Cv | null; claims: number; kept: number };

const EMPTY: Cv = {
  contact: { name: null, email: null, phone: null, location: null, links: [] },
  summary: "",
  experience: [],
  education: [],
  skills: [],
};

function withSection(content: Cv, section: CvSection, from: Cv): Cv {
  return { ...content, [section]: from[section] };
}

/**
 * Fact-checks a revision and swaps only `section` into the content. The corpus adds the current
 * section because it is either already checked or typed by the user.
 */
export function applyRevision(input: ReviseInput, draft: CvDraft): Revision {
  const { source, section, content, answered } = input;
  const checked = checkDraft(draft, { texts: [source, ...answered.map((q) => q.answer), currentSectionBlock(content, section)] });
  const revised = draftToCv(checked).content;
  const empty = JSON.stringify(revised[section]) === JSON.stringify(EMPTY[section]);
  return {
    content: empty ? null : withSection(content, section, revised),
    claims: countClaims(draft),
    kept: countClaims(checked),
  };
}
