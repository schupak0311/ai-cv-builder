import type { Cv } from "../../shared/cv.js";
import type { CvDraft } from "../llm/llm.js";

/**
 * The text a draft may draw facts from: the Source, later joined by Answers. A revision also passes
 * the `current` CV, whose sentences and item fields are kept when copied word for word.
 */
export type Corpus = { texts: string[]; current?: Cv };

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
const SPELLED: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1000000, dozen: 12,
};
// normalise joins "twenty-five" into "twentyfive".
for (const [tens, t] of Object.entries(SPELLED).filter(([, n]) => n >= 20 && n <= 90)) {
  for (const [unit, u] of Object.entries(SPELLED).filter(([, n]) => n <= 9)) SPELLED[tens + unit] = t + u;
}
const NUMBER_WORDS = new Map(Object.entries(SPELLED).map(([word, n]) => [word, String(n)]));

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
      words: new Set([...words(joined), ...words(normalise(quotes.join(" ").replace(/[\p{Pd}−]/gu, " ")))]),
      numbers: new Set(numbers(joined)),
    };
  }

  function holds(text: string, ev: Evidence, sentence: boolean): boolean {
    if (!ev.valid) return false;
    if (!numbers(normalise(text)).every((n) => ev.numbers.has(n))) return false;
    return capitalisedTerms(text, sentence).every((term) => [...words(normalise(term))].every((w) => ev.words.has(w)));
  }

  const same = (a: string | null, b: string | null) => a !== null && b !== null && normalise(a) === normalise(b);
  const current = corpus.current;
  const currentSentences = current ? [current.summary, ...current.experience.flatMap((e) => e.bullets)].map(normalise) : [];
  const copied = (text: string) => currentSentences.some((s) => containsPhrase(s, normalise(text)));
  const field = (value: string | null, ev: Evidence, prior: (string | null)[]) =>
    value !== null && (prior.some((p) => same(p, value)) || holds(value, ev, false)) ? value : null;
  const inSource = (value: string | null) => (value !== null && containsPhrase(source, normalise(value)) ? value : null);
  const sentences = (items: CvDraft["summary"]) => items.filter((s) => copied(s.text) || holds(s.text, evidence(s.evidence), true));

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
        const prior = current?.experience.filter((c) => same(c.employer, item.employer)) ?? [];
        const keep = (key: "employer" | "title" | "location" | "start" | "end") => field(item[key], ev, prior.map((c) => c[key]));
        return {
          employer: keep("employer"),
          title: keep("title"),
          location: keep("location"),
          start: keep("start"),
          end: keep("end"),
          bullets: sentences(item.bullets),
          evidence: item.evidence,
        };
      })
      .filter((item) => item.bullets.length > 0 || [item.employer, item.title, item.location, item.start, item.end].some((v) => v !== null)),
    education: draft.education
      .map((item) => {
        const ev = evidence(item.evidence);
        const prior = current?.education.filter((c) => same(c.institution, item.institution)) ?? [];
        const keep = (key: "institution" | "degree" | "start" | "end") => field(item[key], ev, prior.map((c) => c[key]));
        return {
          institution: keep("institution"),
          degree: keep("degree"),
          start: keep("start"),
          end: keep("end"),
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
