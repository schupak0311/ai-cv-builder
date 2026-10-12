import type { CvDraft } from "../llm/llm.js";

/** The text a draft may draw facts from: the Source, later joined by Answers. */
export type Corpus = { texts: string[] };

const QUOTES: [RegExp, string][] = [
  [/[‘’‚‛′`]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐-―−]/g, "-"],
];
const WORD = /[\p{L}\p{N}]+/gu;
const NUMBER = /\d+(?:[.,]\d+)*/g;
const TERM = /[\p{L}\p{N}][\p{L}\p{N}-]*/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const UPPERCASE = /\p{Lu}/u;
const TITLE_CASE = /^\p{Lu}\p{Ll}*$/u;
const NUMBER_WORDS = new Map(
  Object.entries({
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1000000, dozen: 12,
  }).map(([word, n]) => [word, String(n)]),
);

export function normalise(text: string): string {
  let out = text.normalize("NFKC");
  for (const [pattern, replacement] of QUOTES) out = out.replace(pattern, replacement);
  return out
    .replace(/(\p{L})-\s*(?=\p{L})/gu, "$1")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function words(normalised: string): Set<string> {
  return new Set(normalised.match(WORD));
}

function numbers(normalised: string): string[] {
  const spelled = (normalised.match(WORD) ?? []).flatMap((w) => NUMBER_WORDS.get(w) ?? []);
  return [...(normalised.match(NUMBER) ?? []), ...spelled];
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
 * Terms with an uppercase letter, which a reader takes as names: employers, products, places.
 * In a sentence a plain title-case word that starts it is exempt, in a header field nothing is.
 */
function capitalisedTerms(text: string, exemptSentenceStarts: boolean): string[] {
  const terms: string[] = [];
  for (const match of text.matchAll(TERM)) {
    if (!UPPERCASE.test(match[0])) continue;
    const startsSentence = /(^|[.!?])$/.test(text.slice(0, match.index).trimEnd());
    if (exemptSentenceStarts && startsSentence && TITLE_CASE.test(match[0])) continue;
    terms.push(match[0]);
  }
  return terms;
}

type Evidence = { valid: boolean; words: Set<string>; numbers: Set<string> };

export function checkDraft(draft: CvDraft, corpus: Corpus): CvDraft {
  const source = normalise(corpus.texts.join("\n"));

  function evidence(quotes: string[]): Evidence {
    const normalised = quotes.map(normalise);
    const joined = normalised.join(" ");
    return {
      valid: normalised.length > 0 && normalised.every((q) => words(q).size >= 2 && containsPhrase(source, q)),
      words: words(joined),
      numbers: new Set(numbers(joined)),
    };
  }

  function holds(text: string, ev: Evidence, sentence: boolean): boolean {
    if (!ev.valid) return false;
    if (!numbers(normalise(text)).every((n) => ev.numbers.has(n))) return false;
    return capitalisedTerms(text, sentence).every((term) => [...words(normalise(term))].every((w) => ev.words.has(w)));
  }

  const field = (value: string | null, ev: Evidence) => (value !== null && holds(value, ev, false) ? value : null);
  const inSource = (value: string | null) => (value !== null && containsPhrase(source, normalise(value)) ? value : null);
  const sentences = (items: CvDraft["summary"]) => items.filter((s) => holds(s.text, evidence(s.evidence), true));

  return {
    contact: {
      name: inSource(draft.contact.name),
      email: inSource(draft.contact.email),
      phone: inSource(draft.contact.phone),
      location: inSource(draft.contact.location),
      links: draft.contact.links.filter((link) => inSource(link) !== null),
    },
    summary: sentences(draft.summary),
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
