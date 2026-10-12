import type { CvDraft } from "../llm/llm.js";

/** The text a draft may draw facts from: the Source, later joined by Answers. */
export type Corpus = { targetRole: string; texts: string[] };

const QUOTES: [RegExp, string][] = [
  [/[‘’‚‛′`]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐-―−]/g, "-"],
];
const WORD = /[\p{L}\p{N}]+/gu;
const NUMBER = /\d+(?:[.,]\d+)*/g;
const TERM = /[\p{L}\p{N}][\p{L}\p{N}-]*/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export function normalise(text: string): string {
  let out = text.normalize("NFKC");
  for (const [pattern, replacement] of QUOTES) out = out.replace(pattern, replacement);
  return out
    .replace(/(\p{L})-[ \t]*\r?\n\s*(\p{L})/gu, "$1$2")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function words(normalised: string): Set<string> {
  return new Set(normalised.match(WORD));
}

function numbers(normalised: string): string[] {
  return normalised.match(NUMBER) ?? [];
}

/** True when `needle` occurs in `haystack` and is not glued to a letter or digit on either side. */
function containsPhrase(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    const before = haystack[i - 1] ?? " ";
    const after = haystack[i + needle.length] ?? " ";
    if (!LETTER_OR_DIGIT.test(before) && !LETTER_OR_DIGIT.test(after)) return true;
  }
  return false;
}

/**
 * Capitalised terms a reader takes as names: employers, products, places.
 * For a sentence the first word of each sentence is exempt, for a header field nothing is.
 */
function capitalisedTerms(text: string, exemptSentenceStarts: boolean): string[] {
  const terms: string[] = [];
  for (const match of text.matchAll(TERM)) {
    const first = match[0][0] ?? "";
    if (first === first.toLowerCase()) continue;
    const startsSentence = /(^|[.!?:]\s*)$/.test(text.slice(0, match.index).trimEnd());
    if (exemptSentenceStarts && startsSentence) continue;
    terms.push(match[0]);
  }
  return terms;
}

type Evidence = { valid: boolean; words: Set<string>; numbers: Set<string> };

export function checkDraft(draft: CvDraft, corpus: Corpus): CvDraft {
  const source = normalise(corpus.texts.join("\n"));
  const roleWords = words(normalise(corpus.targetRole));

  function evidence(quotes: string[]): Evidence {
    const normalised = quotes.map(normalise);
    const joined = normalised.join(" ");
    return {
      valid: normalised.length > 0 && normalised.every((q) => q.length > 0 && source.includes(q)),
      words: words(joined),
      numbers: new Set(numbers(joined)),
    };
  }

  function holds(text: string, ev: Evidence, opts: { sentence: boolean; allowed?: Set<string> }): boolean {
    if (!ev.valid) return false;
    if (!numbers(normalise(text)).every((n) => ev.numbers.has(n))) return false;
    return capitalisedTerms(text, opts.sentence).every((term) =>
      [...words(normalise(term))].every((w) => ev.words.has(w) || opts.allowed?.has(w) === true),
    );
  }

  const field = (value: string | null, ev: Evidence) =>
    value !== null && holds(value, ev, { sentence: false }) ? value : null;
  const inSource = (value: string | null) => (value !== null && containsPhrase(source, normalise(value)) ? value : null);
  const sentences = (items: CvDraft["summary"], allowed?: Set<string>) =>
    items.filter((s) => holds(s.text, evidence(s.evidence), { sentence: true, ...(allowed && { allowed }) }));

  return {
    contact: {
      name: inSource(draft.contact.name),
      email: inSource(draft.contact.email),
      phone: inSource(draft.contact.phone),
      location: inSource(draft.contact.location),
      links: draft.contact.links.filter((link) => inSource(link) !== null),
    },
    summary: sentences(draft.summary, roleWords),
    experience: draft.experience
      .map((item) => {
        const ev = evidence(item.evidence);
        return {
          employer: field(item.employer, ev),
          title: field(item.title, ev),
          location: field(item.location, ev),
          start: field(item.start, ev),
          end: field(item.end, ev),
          bullets: sentences(item.bullets),
          evidence: item.evidence,
        };
      })
      .filter((item) => item.bullets.length > 0 || [item.employer, item.title, item.location, item.start, item.end].some((v) => v !== null)),
    education: draft.education
      .map((item) => {
        const ev = evidence(item.evidence);
        return {
          institution: field(item.institution, ev),
          degree: field(item.degree, ev),
          start: field(item.start, ev),
          end: field(item.end, ev),
          evidence: item.evidence,
        };
      })
      .filter((item) => [item.institution, item.degree, item.start, item.end].some((v) => v !== null)),
    skills: draft.skills.filter((skill) => inSource(skill) !== null),
    questions: draft.questions,
  };
}

/** Counts every Claim the fact check can keep or drop, for logging how many it dropped. */
export function countClaims(draft: CvDraft): number {
  const present = (values: (string | null)[]) => values.filter((v) => v !== null).length;
  const { name, email, phone, location, links } = draft.contact;
  return (
    present([name, email, phone, location]) +
    links.length +
    draft.summary.length +
    draft.experience.reduce(
      (n, e) => n + e.bullets.length + present([e.employer, e.title, e.location, e.start, e.end]),
      0,
    ) +
    draft.education.reduce((n, e) => n + present([e.institution, e.degree, e.start, e.end]), 0) +
    draft.skills.length
  );
}
