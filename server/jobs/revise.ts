import type { Cv, CvSection } from "../../shared/cv.js";
import { checkDraft, countClaims } from "../factcheck/factcheck.js";
import { draftToCv, sectionText, type CvDraft, type ReviseInput } from "../llm/llm.js";

export type Revision = { content: Cv; claims: number; kept: number; keptCurrent: boolean };

function withSection(content: Cv, section: CvSection, from: Cv): Cv {
  return { ...content, [section]: from[section] };
}

/**
 * Fact-checks a revision and swaps only `section` into the content. The corpus adds the current
 * section text because it is either already checked or typed by the user. An empty result never
 * replaces a non-empty section, so a bad revision cannot wipe it.
 */
export function applyRevision(input: ReviseInput, draft: CvDraft): Revision {
  const { source, section, content, answered } = input;
  const current = sectionText(content, section);
  const checked = checkDraft(draft, { texts: [source, ...answered.map((q) => q.answer), current] });
  const revised = draftToCv(checked).content;
  const keptCurrent = sectionText(revised, section).trim() === "" && current.trim() !== "";
  return {
    content: keptCurrent ? content : withSection(content, section, revised),
    claims: countClaims(draft),
    kept: countClaims(checked),
    keptCurrent,
  };
}
