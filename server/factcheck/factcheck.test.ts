import { describe, expect, test } from "vitest";
import type { CvDraft } from "../llm/llm.js";
import { checkDraft, countClaims, normalise } from "./factcheck.js";

const SOURCE = [
  "Anna Example, Manchester, UK. anna@example.com, +44 20 7946 0958, github.com/anna-example",
  "Senior Engineer at Northwind Logistics, Apr 2021 to Present.",
  "Cut nightly load time from 6 hours to 75 minutes with incremen-",
  "tal Spark jobs.",
  "Data Engineer at Brightwater Insurance, Jan 2018 to Mar 2021.",
  "Reduced cloud spend by 38% through “partition pruning”.",
  "BSc Computer Science, University of Leeds, 2011 to 2015.",
  "Skills: Python, SQL, Kafka",
].join("\n");
const corpus = { targetRole: "Senior Data Engineer", texts: [SOURCE] };

const EMPTY: CvDraft = {
  contact: { name: null, email: null, phone: null, location: null, links: [] },
  summary: [],
  experience: [],
  education: [],
  skills: [],
  questions: [],
};
const draft = (part: Partial<CvDraft>): CvDraft => ({ ...EMPTY, ...part });

const NORTHWIND = ["Senior Engineer at Northwind Logistics, Apr 2021 to Present."];
const job = (part: Partial<CvDraft["experience"][number]>): CvDraft["experience"][number] => ({
  employer: null,
  title: null,
  location: null,
  start: null,
  end: null,
  bullets: [],
  evidence: NORTHWIND,
  ...part,
});

describe("checkDraft", () => {
  test.each<{ name: string; input: CvDraft; expected: CvDraft }>([
    {
      name: "a bullet whose quote is not in the Source is dropped",
      input: draft({
        experience: [
          job({
            employer: "Northwind Logistics",
            bullets: [
              { text: "Cut nightly load time to 75 minutes.", evidence: ["Cut nightly load time from 6 hours to 75 minutes"] },
              { text: "Mentored four engineers.", evidence: ["Mentored four engineers."] },
            ],
          }),
        ],
      }),
      expected: draft({
        experience: [
          job({
            employer: "Northwind Logistics",
            bullets: [{ text: "Cut nightly load time to 75 minutes.", evidence: ["Cut nightly load time from 6 hours to 75 minutes"] }],
          }),
        ],
      }),
    },
    {
      name: "a number moved from one job to another is dropped",
      input: draft({
        experience: [
          job({
            employer: "Northwind Logistics",
            bullets: [{ text: "Reduced load time by 38%.", evidence: ["Cut nightly load time from 6 hours to 75 minutes"] }],
          }),
        ],
      }),
      expected: draft({ experience: [job({ employer: "Northwind Logistics" })] }),
    },
    {
      name: "an invented capitalised employer is dropped from a bullet and nulled in the header",
      input: draft({
        experience: [
          job({
            employer: "Globex Corporation",
            title: "Senior Engineer",
            bullets: [
              { text: "Cut load time at Globex with Spark jobs.", evidence: ["Cut nightly load time from 6 hours to 75 minutes"] },
              { text: "Moved nightly loads to incremental Spark jobs.", evidence: ["incremental Spark jobs"] },
            ],
          }),
        ],
      }),
      expected: draft({
        experience: [
          job({
            employer: null,
            title: "Senior Engineer",
            bullets: [{ text: "Moved nightly loads to incremental Spark jobs.", evidence: ["incremental Spark jobs"] }],
          }),
        ],
      }),
    },
    {
      name: "a header field that is not in its own evidence becomes null",
      input: draft({
        experience: [job({ employer: "Brightwater Insurance", title: "Senior Engineer", start: "Jan 2018", end: "Present" })],
        education: [
          {
            institution: "University of Leeds",
            degree: "MSc Computer Science",
            start: "2011",
            end: "2016",
            evidence: ["BSc Computer Science, University of Leeds, 2011 to 2015."],
          },
        ],
      }),
      expected: draft({
        experience: [job({ employer: null, title: "Senior Engineer", start: null, end: "Present" })],
        education: [
          {
            institution: "University of Leeds",
            degree: null,
            start: "2011",
            end: null,
            evidence: ["BSc Computer Science, University of Leeds, 2011 to 2015."],
          },
        ],
      }),
    },
    {
      name: "a job whose evidence is not in the Source loses every header field and is removed",
      input: draft({ experience: [job({ employer: "Northwind Logistics", evidence: ["Northwind Logistics, 2019 to 2021"] })] }),
      expected: draft({ experience: [] }),
    },
    {
      name: "contact values, links and skills not in the Source are dropped",
      input: draft({
        contact: {
          name: "Anna Example",
          email: "anna.example@gmail.com",
          phone: "+44 20 7946 0958",
          location: "London",
          links: ["github.com/anna-example", "linkedin.com/in/anna"],
        },
        skills: ["Python", "Kafka", "Go", "Kubernetes"],
      }),
      expected: draft({
        contact: { name: "Anna Example", email: null, phone: "+44 20 7946 0958", location: null, links: ["github.com/anna-example"] },
        skills: ["Python", "Kafka"],
      }),
    },
    {
      name: "quotes, dashes, case, whitespace and line-end hyphenation are normalised",
      input: draft({
        experience: [
          job({
            bullets: [
              {
                text: "Cut cloud spend by 38% with partition pruning.",
                evidence: ["reduced cloud   spend by 38% through \"partition pruning\""],
              },
              { text: "Moved loads to incremental Spark jobs.", evidence: ["with incremental Spark jobs"] },
              { text: "Worked in Manchester’s office.", evidence: ["Anna Example, Manchester, UK"] },
            ],
          }),
        ],
      }),
      expected: draft({
        experience: [
          job({
            bullets: [
              {
                text: "Cut cloud spend by 38% with partition pruning.",
                evidence: ["reduced cloud   spend by 38% through \"partition pruning\""],
              },
              { text: "Moved loads to incremental Spark jobs.", evidence: ["with incremental Spark jobs"] },
              { text: "Worked in Manchester\u2019s office.", evidence: ["Anna Example, Manchester, UK"] },
            ],
          }),
        ],
      }),
    },
    {
      name: "the Target role is allowed in the summary but not in a bullet",
      input: draft({
        summary: [
          { text: "Senior Data Engineer who builds Spark pipelines.", evidence: ["incremental Spark jobs"] },
          { text: "Experienced at Brightwater Insurance and Acme.", evidence: ["Data Engineer at Brightwater Insurance"] },
          { text: "Ready for a Senior Data Engineer role.", evidence: [] },
        ],
        experience: [job({ bullets: [{ text: "Grew into a Data role on Spark.", evidence: ["incremental Spark jobs"] }] })],
      }),
      expected: draft({
        summary: [{ text: "Senior Data Engineer who builds Spark pipelines.", evidence: ["incremental Spark jobs"] }],
        experience: [],
      }),
    },
  ])("$name", ({ input, expected }) => {
    expect(checkDraft(input, corpus)).toEqual(expected);
  });

  test("Questions pass through and Answers count as corpus", () => {
    const questions: CvDraft["questions"] = [{ section: "experience", text: "When did you leave Brightwater Insurance?" }];
    const input = draft({
      experience: [job({ employer: "Brightwater Insurance", end: "Jun 2021", evidence: ["Left Brightwater Insurance in Jun 2021"] })],
      questions,
    });
    expect(checkDraft(input, { ...corpus, texts: [SOURCE, "Left Brightwater Insurance in Jun 2021"] })).toEqual(input);
    expect(checkDraft(input, corpus)).toEqual(draft({ questions }));
  });
});

test("normalise folds the characters PDFs and models vary on", () => {
  expect(normalise("  “Smart”  quotes’ — and ﬁ liga-\n  ture\tCASE ")).toBe("\"smart\" quotes' - and fi ligature case");
});

test("countClaims counts every value the fact check can drop", () => {
  expect(
    countClaims(
      draft({
        contact: { name: "Anna", email: null, phone: null, location: null, links: ["a.example"] },
        summary: [{ text: "One.", evidence: [] }],
        experience: [job({ employer: "Northwind", start: "2021", bullets: [{ text: "Two.", evidence: [] }] })],
        education: [{ institution: "Leeds", degree: null, start: null, end: null, evidence: [] }],
        skills: ["Python", "SQL"],
      }),
    ),
  ).toBe(9);
});
