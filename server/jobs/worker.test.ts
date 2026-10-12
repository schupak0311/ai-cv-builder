import type { FastifyInstance } from "fastify";
import { describe, expect, test } from "vitest";
import type { CvDetail } from "../../shared/api.js";
import { createCv, signUp, useTestApp } from "../../test/helpers.js";
import { createFakeLlm, fakeDraft, fakeRevise } from "../llm/fake.js";
import { LlmError, type Llm } from "../llm/llm.js";
import { claimNextJob, processNextJob, requeueRunningJobs } from "./worker.js";

const ctx = useTestApp();
const fakeLlm = createFakeLlm(0);

function failingLlm(error: Error): Llm {
  return { draft: () => Promise.reject(error), revise: () => Promise.reject(error) };
}

async function deps(llm: Llm) {
  const app = await ctx.app();
  return { sql: ctx.sql, llm, log: app.log };
}

async function detail(app: FastifyInstance, cookie: string, id: string): Promise<CvDetail> {
  const res = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie } });
  return res.json<CvDetail>();
}

const EXPECTED_CONTENT = {
  contact: {
    name: "Anna Example",
    email: "anna@example.com",
    phone: "+44 20 7946 0958",
    location: null,
    links: [],
  },
  summary: "Backend engineer with eight years of experience building payment systems.",
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

describe("jobs", () => {
  test("a generate job with the fake model ends done with content and questions", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await createCv(app, cookie);

    expect(await processNextJob(await deps(fakeLlm))).toBe(true);

    const cv = await detail(app, cookie, id);
    expect(cv.job).toBeNull();
    expect(cv.error).toBeNull();
    expect(cv.content).toEqual(EXPECTED_CONTENT);
    expect(cv.version).toBe(2);
    expect(cv.questions.map(({ section, text, answer }) => ({ section, text, answer }))).toEqual([
      { section: "summary", text: "What makes you a strong fit for the Senior Backend Engineer role?", answer: null },
    ]);
    const list = await app.inject({ method: "GET", url: "/api/cvs", headers: { cookie } });
    expect(list.json()).toMatchObject([{ id, status: "done" }]);
    expect(await processNextJob(await deps(fakeLlm))).toBe(false);
  });

  test("invented Claims from the model never reach the stored CV", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await createCv(app, cookie);
    const inventing: Llm = {
      draft(input) {
        const draft = fakeDraft(input);
        const [job] = draft.experience;
        if (job === undefined) throw new Error("The fake draft has no experience item");
        job.employer = "Globex Payments";
        job.evidence = ["Led the migration of the billing service to PostgreSQL."];
        job.bullets.push({
          text: "Grew checkout conversion by 40%.",
          evidence: ["Led the migration of the billing service to PostgreSQL."],
        });
        return Promise.resolve(draft);
      },
      revise: (input) => Promise.resolve(fakeRevise(input)),
    };

    await processNextJob(await deps(inventing));

    const cv = await detail(app, cookie, id);
    expect(cv.error).toBeNull();
    expect(cv.content).toEqual(EXPECTED_CONTENT);
  });

  test("a retryable model error is retried, then fails after three attempts", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await createCv(app, cookie);
    const busy = await deps(failingLlm(new LlmError("Claude is busy right now. Try again in a minute.", true)));

    await processNextJob(busy);
    expect((await detail(app, cookie, id)).job?.status).toBe("queued");
    await processNextJob(busy);
    expect((await detail(app, cookie, id)).job?.status).toBe("queued");
    await processNextJob(busy);

    const cv = await detail(app, cookie, id);
    expect(cv.job).toBeNull();
    expect(cv.content).toBeNull();
    expect(cv.error).toBe("Claude is busy right now. Try again in a minute.");
    expect(await ctx.sql`select status, attempts from jobs`).toEqual([{ status: "failed", attempts: 3 }]);
    expect(await processNextJob(busy)).toBe(false);
  });

  test("an unexpected error fails at once with a generic message", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await createCv(app, cookie);

    await processNextJob(await deps(failingLlm(new Error("socket hang up at 10.0.0.3"))));

    const cv = await detail(app, cookie, id);
    expect(cv.job).toBeNull();
    expect(cv.error).toBe("Something went wrong while drafting this CV. Try again.");
  });

  test("a job left running at boot is requeued and then completes", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await createCv(app, cookie);
    await claimNextJob(ctx.sql);
    expect((await detail(app, cookie, id)).job?.status).toBe("running");

    expect(await requeueRunningJobs(ctx.sql)).toBe(1);
    expect((await detail(app, cookie, id)).job?.status).toBe("queued");

    await processNextJob(await deps(fakeLlm));
    const cv = await detail(app, cookie, id);
    expect(cv.job).toBeNull();
    expect(cv.content).toEqual(EXPECTED_CONTENT);
  });
});
