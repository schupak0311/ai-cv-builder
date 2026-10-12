import type { FastifyInstance } from "fastify";
import { describe, expect, test } from "vitest";
import type { CvDetail } from "../../shared/api.js";
import { createCv, signUp, useTestApp } from "../../test/helpers.js";
import { processNextJob } from "../jobs/worker.js";
import { createFakeLlm } from "../llm/fake.js";
import { LlmError, type CvDraft, type Llm } from "../llm/llm.js";

const ctx = useTestApp();
const fakeLlm = createFakeLlm(0);

const SUMMARY = "Backend engineer with eight years of experience building payment systems.";
const ANSWER = "I mentor two junior engineers every week.";
const OTHER_SECTIONS = {
  contact: { name: "Anna Example", email: "anna@example.com", phone: "+44 20 7946 0958", location: null, links: [] },
  experience: [
    {
      id: "exp-1",
      employer: null,
      title: null,
      location: null,
      start: null,
      end: null,
      bullets: [
        "Led the migration of the billing service to PostgreSQL.",
        "Cut API latency by 40% by adding a caching layer.",
      ],
    },
  ],
  education: [],
  skills: ["TypeScript", "PostgreSQL", "Kafka"],
};

async function run(llm: Llm): Promise<boolean> {
  const app = await ctx.app();
  return processNextJob({ sql: ctx.sql, llm, log: app.log });
}

async function detail(app: FastifyInstance, cookie: string, id: string): Promise<CvDetail> {
  const res = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie } });
  expect(res.statusCode).toBe(200);
  return res.json<CvDetail>();
}

/** A CV whose generate job has finished, with its one summary Question. */
async function doneCv(app: FastifyInstance, cookie: string): Promise<{ id: string; questionId: string }> {
  const id = await createCv(app, cookie);
  expect(await run(fakeLlm)).toBe(true);
  const [question] = (await detail(app, cookie, id)).questions;
  if (question === undefined) throw new Error("The fake draft has no Question");
  return { id, questionId: question.id };
}

function answer(app: FastifyInstance, cookie: string, id: string, questionId: string, text: string) {
  return app.inject({
    method: "POST",
    url: `/api/cvs/${id}/questions/${questionId}/answer`,
    headers: { cookie },
    payload: { answer: text },
  });
}

function scripted(revise: CvDraft): Llm {
  return { draft: () => Promise.reject(new Error("unused")), revise: () => Promise.resolve(revise) };
}

const EMPTY: CvDraft = {
  contact: { name: null, email: null, phone: null, location: null, links: [] },
  summary: [],
  experience: [],
  education: [],
  skills: [],
  questions: [],
};

async function jobs() {
  return ctx.sql`select kind, payload, status from jobs order by created_at`;
}

describe("answering a Question", () => {
  test("revises only the summary and bumps the version", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const { id, questionId } = await doneCv(app, cookie);

    const res = await answer(app, cookie, id, questionId, `  ${ANSWER}  `);
    expect(res.statusCode).toBe(202);
    const queued = await detail(app, cookie, id);
    expect(queued.job?.status).toBe("queued");
    expect(queued.version).toBe(2);
    expect(queued.questions.map((q) => q.answer)).toEqual([null]);
    expect(await jobs()).toEqual([
      { kind: "generate", payload: {}, status: "done" },
      { kind: "revise", payload: { questionId, answer: ANSWER }, status: "queued" },
    ]);

    expect(await run(fakeLlm)).toBe(true);

    const cv = await detail(app, cookie, id);
    expect(cv.job).toBeNull();
    expect(cv.error).toBeNull();
    expect(cv.version).toBe(3);
    expect(cv.content).toEqual({ ...OTHER_SECTIONS, summary: `${SUMMARY} ${ANSWER}` });
    expect(cv.questions.map((q) => q.answer)).toEqual([ANSWER]);
  });

  test("drops an invented number but keeps facts from the Answer and the current section", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const { id, questionId } = await doneCv(app, cookie);
    const typedByUser = "Payments specialist since 2016.";
    await ctx.sql`update cvs set content = jsonb_set(content, '{summary}', ${ctx.sql.json(typedByUser)}) where id = ${id}`;
    const fromAnswer = "I mentor 2 junior engineers every week.";
    expect((await answer(app, cookie, id, questionId, fromAnswer)).statusCode).toBe(202);

    await run(
      scripted({
        ...EMPTY,
        summary: [
          { text: "Payments specialist since 2016.", evidence: [typedByUser] },
          { text: "Grew revenue by 35% in 2021.", evidence: [fromAnswer] },
          { text: "Mentors 2 junior engineers every week.", evidence: [fromAnswer] },
        ],
        skills: ["Rust"],
      }),
    );

    const cv = await detail(app, cookie, id);
    expect(cv.content).toEqual({
      ...OTHER_SECTIONS,
      summary: "Payments specialist since 2016. Mentors 2 junior engineers every week.",
    });
  });

  test("revises the experience section from evidence quoted out of the current section", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const { id } = await doneCv(app, cookie);
    await ctx.sql`update cvs set content = jsonb_set(content, '{experience,0,employer}', '"Paylane"') where id = ${id}`;
    const [question] = await ctx.sql<{ id: string }[]>`
      insert into questions (cv_id, section, text) values (${id}, 'experience', 'What was your title at Paylane?') returning id
    `;
    if (question === undefined) throw new Error("Insert returned no Question");
    const fromAnswer = "I was a Backend Engineer there from 2019 to 2024.";
    expect((await answer(app, cookie, id, question.id, fromAnswer)).statusCode).toBe(202);

    const bullets = OTHER_SECTIONS.experience[0]!.bullets;
    await run(
      scripted({
        ...EMPTY,
        experience: [
          {
            employer: "Paylane",
            title: "Backend Engineer",
            location: null,
            start: "2019",
            end: "2024",
            bullets: bullets.map((text) => ({ text, evidence: [text] })),
            evidence: ['"employer": "Paylane"', fromAnswer],
          },
        ],
      }),
    );

    const cv = await detail(app, cookie, id);
    expect(cv.error).toBeNull();
    expect(cv.content).toEqual({
      ...OTHER_SECTIONS,
      summary: SUMMARY,
      experience: [{ id: "exp-1", employer: "Paylane", title: "Backend Engineer", location: null, start: "2019", end: "2024", bullets }],
    });
    expect(cv.questions.map((q) => q.answer)).toEqual([null, fromAnswer]);
  });

  test("a revision that comes back empty after the fact check fails and leaves the Question open", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const { id, questionId } = await doneCv(app, cookie);
    expect((await answer(app, cookie, id, questionId, ANSWER)).statusCode).toBe(202);

    await run(scripted({ ...EMPTY, summary: [{ text: "Won 3 industry awards.", evidence: ["Won 3 industry awards."] }] }));

    const cv = await detail(app, cookie, id);
    expect(cv.job).toBeNull();
    expect(cv.error).toBe("Claude could not use this answer. Try again, or edit the section by hand.");
    expect(cv.version).toBe(2);
    expect(cv.content).toEqual({ ...OTHER_SECTIONS, summary: SUMMARY });
    expect(cv.questions.map((q) => q.answer)).toEqual([null]);
    expect((await answer(app, cookie, id, questionId, ANSWER)).statusCode).toBe(202);
  });

  test("a failed revise leaves its Question open after another Question is answered", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const { id, questionId } = await doneCv(app, cookie);
    const [skills] = await ctx.sql<{ id: string }[]>`
      insert into questions (cv_id, section, text) values (${id}, 'skills', 'Which tools do you use?') returning id
    `;
    if (skills === undefined) throw new Error("Insert returned no Question");

    expect((await answer(app, cookie, id, questionId, ANSWER)).statusCode).toBe(202);
    const refusing = new LlmError("Claude declined to process this CV.", false);
    await run({ draft: () => Promise.reject(refusing), revise: () => Promise.reject(refusing) });
    expect((await answer(app, cookie, id, skills.id, "Docker and Grafana.")).statusCode).toBe(202);
    await run(scripted({ ...EMPTY, skills: ["TypeScript", "PostgreSQL", "Kafka", "Docker", "Grafana"] }));

    const afterSkills = await detail(app, cookie, id);
    expect(afterSkills.error).toBeNull();
    expect(afterSkills.questions.map((q) => q.answer)).toEqual([null, "Docker and Grafana."]);

    expect((await answer(app, cookie, id, questionId, ANSWER)).statusCode).toBe(202);
    await run(fakeLlm);
    const cv = await detail(app, cookie, id);
    expect(cv.content).toEqual({
      ...OTHER_SECTIONS,
      skills: ["TypeScript", "PostgreSQL", "Kafka", "Docker", "Grafana"],
      summary: `${SUMMARY} ${ANSWER}`,
    });
    expect(cv.questions.map((q) => q.answer)).toEqual([ANSWER, "Docker and Grafana."]);
  });

  test("a NUL character in an Answer is removed", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const { id, questionId } = await doneCv(app, cookie);
    expect((await answer(app, cookie, id, questionId, `I mentor\u0000 two junior engineers every week.`)).statusCode).toBe(202);
    await run(fakeLlm);
    expect((await detail(app, cookie, id)).questions.map((q) => q.answer)).toEqual([ANSWER]);
  });

  test("is rejected for a foreign CV, a foreign Question, a busy CV and a second answer, storing nothing", async () => {
    const app = await ctx.app();
    const anna = await signUp(app, "anna@example.com");
    const first = await doneCv(app, anna);
    const second = await doneCv(app, anna);
    const bob = await signUp(app, "bob@example.com");
    const [extra] = await ctx.sql<{ id: string }[]>`
      insert into questions (cv_id, section, text) values (${first.id}, 'skills', 'Which tools do you use?') returning id
    `;
    if (extra === undefined) throw new Error("Insert returned no Question");

    const rejected = [
      { res: await answer(app, bob, first.id, first.questionId, ANSWER), status: 404, error: "Question not found." },
      { res: await answer(app, anna, first.id, second.questionId, ANSWER), status: 404, error: "Question not found." },
      { res: await answer(app, anna, first.id, "not-a-uuid", ANSWER), status: 404, error: "Question not found." },
      { res: await answer(app, anna, first.id, first.questionId, "   "), status: 400, error: "Write an answer first." },
      { res: await answer(app, anna, first.id, first.questionId, "x".repeat(2_001)), status: 400, error: "Keep the answer under 2,000 characters." },
    ];
    for (const { res, status, error } of rejected) {
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error });
    }
    expect(await ctx.sql`select answer from questions where answer is not null`).toEqual([]);

    expect((await answer(app, anna, first.id, first.questionId, ANSWER)).statusCode).toBe(202);
    const busy = await answer(app, anna, first.id, extra.id, "Docker and Grafana.");
    expect(busy.statusCode).toBe(409);
    expect(busy.json()).toEqual({ error: "Wait for the current update to finish." });

    await run(fakeLlm);
    const again = await answer(app, anna, first.id, first.questionId, "Something else.");
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: "This question already has an answer." });

    expect(await ctx.sql`select text, answer from questions where answer is not null`).toEqual([
      { text: "What makes you a strong fit for the Senior Backend Engineer role?", answer: ANSWER },
    ]);
    expect(await jobs()).toEqual([
      { kind: "generate", payload: {}, status: "done" },
      { kind: "generate", payload: {}, status: "done" },
      { kind: "revise", payload: { questionId: first.questionId, answer: ANSWER }, status: "done" },
    ]);
  });
});

describe("retrying a job", () => {
  test("re-queues a failed revise with the same payload, then refuses once it is done", async () => {
    const app = await ctx.app();
    const anna = await signUp(app, "anna@example.com");
    const { id, questionId } = await doneCv(app, anna);
    expect((await answer(app, anna, id, questionId, ANSWER)).statusCode).toBe(202);
    const refusing = new LlmError("Claude declined to process this CV.", false);
    await run({ draft: () => Promise.reject(refusing), revise: () => Promise.reject(refusing) });
    const failed = await detail(app, anna, id);
    expect(failed.error).toBe("Claude declined to process this CV.");
    expect(failed.questions.map((q) => q.answer)).toEqual([null]);

    const bob = await signUp(app, "bob@example.com");
    const foreign = await app.inject({ method: "POST", url: `/api/cvs/${id}/retry`, headers: { cookie: bob } });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({ error: "CV not found." });

    const retry = await app.inject({ method: "POST", url: `/api/cvs/${id}/retry`, headers: { cookie: anna } });
    expect(retry.statusCode).toBe(202);
    expect(await jobs()).toEqual([
      { kind: "generate", payload: {}, status: "done" },
      { kind: "revise", payload: { questionId, answer: ANSWER }, status: "failed" },
      { kind: "revise", payload: { questionId, answer: ANSWER }, status: "queued" },
    ]);

    await run(fakeLlm);
    const revised = await detail(app, anna, id);
    expect(revised.content?.summary).toBe(`${SUMMARY} ${ANSWER}`);
    expect(revised.questions.map((q) => q.answer)).toEqual([ANSWER]);

    const nothing = await app.inject({ method: "POST", url: `/api/cvs/${id}/retry`, headers: { cookie: anna } });
    expect(nothing.statusCode).toBe(409);
    expect(nothing.json()).toEqual({ error: "Nothing to retry." });
    expect(await ctx.sql`select count(*)::int as n from jobs`).toEqual([{ n: 3 }]);
  });
});
