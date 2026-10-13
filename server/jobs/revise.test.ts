import { expect, test } from "vitest";
import type { Cv } from "../../shared/cv.js";
import type { CvDraft, ReviseInput } from "../llm/llm.js";
import { applyRevision } from "./revise.js";

const SOURCE = [
  "NORTHWIND LOGISTICS Manchester, UK",
  "Senior Engineer 2021-Present",
  "Builds freight software for Northwind Logistics customers across the",
  "UK and Ireland.",
  "● Atlas (Freight Platform): Led API design with NestJS for booking, real-time",
  "tracking and messaging, and ran the \"Ship it\" release review for the",
  "Atlas team.",
].join("\n");

const LED = "Led API design with NestJS for the Atlas freight platform, covering booking, real-time tracking and messaging.";
const RAN = 'Ran the "Ship it" release review for the Atlas team.';
const SUMMARY = "Builds freight software for Northwind Logistics customers across the UK and Ireland.";

const CONTENT: Cv = {
  contact: { name: null, email: null, phone: null, location: null, links: [] },
  summary: SUMMARY,
  experience: [
    {
      id: "exp-1",
      employer: "NORTHWIND LOGISTICS",
      title: "Senior Engineer",
      location: "Manchester, UK",
      start: "2021",
      end: "Present",
      bullets: [LED, RAN],
    },
  ],
  education: [],
  skills: [],
};

const EMPTY: CvDraft = {
  contact: { name: null, email: null, phone: null, location: null, links: [] },
  summary: [],
  experience: [],
  education: [],
  skills: [],
  questions: [],
};

const ANSWER = "I mentored 3 junior engineers on the Atlas team.";
const input = (section: ReviseInput["section"]): ReviseInput => ({
  targetRole: "Engineering Manager",
  source: SOURCE,
  section,
  content: CONTENT,
  answered: [{ section, text: "Did you lead anyone?", answer: ANSWER }],
});

const header = {
  employer: "NORTHWIND LOGISTICS",
  title: "Senior Engineer",
  location: "Manchester, UK",
  start: "2021",
  end: "Present",
  evidence: ["NORTHWIND LOGISTICS Manchester, UK", "Senior Engineer 2021-Present"],
};

test("current bullets copied word for word survive quotes cut at a line break, and new ones still need evidence", () => {
  const draft: CvDraft = {
    ...EMPTY,
    experience: [
      {
        ...header,
        bullets: [
          { text: LED, evidence: ["Led API design with NestJS for booking, real-time"] },
          { text: RAN, evidence: ["and ran the \"Ship it\" release review for the"] },
          { text: "Mentored 3 junior engineers on the Atlas team.", evidence: [ANSWER] },
          { text: "Led API design for the Atlas platform with 12 engineers.", evidence: ["Led API design with NestJS for booking, real-time"] },
        ],
      },
    ],
  };
  expect(applyRevision(input("experience"), draft)).toEqual({
    content: {
      ...CONTENT,
      experience: [{ ...CONTENT.experience[0], bullets: [LED, RAN, "Mentored 3 junior engineers on the Atlas team."] }],
    },
    claims: 9,
    kept: 8,
  });
});

test("a current summary sentence copied word for word survives a quote cut at a line break", () => {
  const draft: CvDraft = {
    ...EMPTY,
    summary: [
      { text: SUMMARY, evidence: ["Builds freight software for Northwind Logistics customers across the"] },
      { text: "Mentored 3 junior engineers.", evidence: [ANSWER] },
    ],
  };
  expect(applyRevision(input("summary"), draft)).toEqual({
    content: { ...CONTENT, summary: `${SUMMARY} Mentored 3 junior engineers.` },
    claims: 2,
    kept: 2,
  });
});
