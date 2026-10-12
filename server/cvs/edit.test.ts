import { describe, expect, test } from "vitest";
import type { Cv } from "../../shared/cv.js";
import { createCv, signUp, useTestApp } from "../../test/helpers.js";

const ctx = useTestApp();

const CONTENT: Cv = {
  contact: { name: "Anna Example", email: "anna@example.com", phone: null, location: "London", links: [] },
  summary: "Backend engineer with eight years of experience building payment systems.",
  experience: [
    {
      id: "exp-1",
      employer: "Paylane",
      title: "Backend Engineer",
      location: null,
      start: "2019",
      end: "2024",
      bullets: ["Led the migration of the billing service to PostgreSQL."],
    },
  ],
  education: [],
  skills: ["TypeScript", "PostgreSQL"],
};

const EDITED: Cv = {
  ...CONTENT,
  experience: [{ ...CONTENT.experience[0]!, bullets: ["Moved billing to PostgreSQL with zero downtime."] }],
};

async function draftedCv(cookie: string): Promise<string> {
  const id = await createCv(await ctx.app(), cookie);
  await ctx.sql`update cvs set content = ${ctx.sql.json(CONTENT)} where id = ${id}`;
  await ctx.sql`update jobs set status = 'done' where cv_id = ${id}`;
  return id;
}

async function save(cookie: string, id: string, body: { content: object; version: number }) {
  const app = await ctx.app();
  return app.inject({ method: "PUT", url: `/api/cvs/${id}`, headers: { cookie }, payload: body });
}

async function storedContent(id: string): Promise<{ content: unknown; version: number }> {
  const [row] = await ctx.sql<{ content: unknown; version: number }[]>`
    select content, version from cvs where id = ${id}
  `;
  return row!;
}

describe("saving hand edits", () => {
  test("a save bumps the version and a reload returns the edited content", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await draftedCv(cookie);

    const res = await save(cookie, id, { content: EDITED, version: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 2 });

    const reload = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie } });
    expect(reload.json()).toMatchObject({ version: 2, content: EDITED });
  });

  test("a stale version gets a 409 and changes nothing", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await draftedCv(cookie);
    expect((await save(cookie, id, { content: EDITED, version: 1 })).statusCode).toBe(200);

    const res = await save(cookie, id, { content: CONTENT, version: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "This CV changed somewhere else. Reload to get the latest version." });
    expect(await storedContent(id)).toEqual({ content: EDITED, version: 2 });
  });

  test("a save while a job is queued gets a 409 and changes nothing", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await draftedCv(cookie);
    await ctx.sql`insert into jobs (cv_id, kind, status) values (${id}, 'revise', 'queued')`;

    const res = await save(cookie, id, { content: EDITED, version: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "Wait for the current update to finish." });
    expect(await storedContent(id)).toEqual({ content: CONTENT, version: 1 });
    const detail = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie } });
    expect(detail.json()).toMatchObject({ job: { kind: "revise", status: "queued" } });
  });

  test("a CV without content yet cannot be saved", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await createCv(app, cookie);
    await ctx.sql`update jobs set status = 'failed' where cv_id = ${id}`;

    const res = await save(cookie, id, { content: EDITED, version: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "This CV has no content yet." });
    expect(await storedContent(id)).toEqual({ content: null, version: 1 });
  });

  test("another user gets 404 and the CV is unchanged", async () => {
    const app = await ctx.app();
    const anna = await signUp(app, "anna@example.com");
    const bob = await signUp(app, "bob@example.com");
    const id = await draftedCv(anna);

    const res = await save(bob, id, { content: EDITED, version: 1 });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "CV not found." });
    expect(await storedContent(id)).toEqual({ content: CONTENT, version: 1 });
  });

  test("content over the hand-edit limits is rejected", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await draftedCv(cookie);
    const cases = [
      { content: { ...CONTENT, summary: "x".repeat(3_001) }, error: "Keep the summary under 3,000 characters." },
      {
        content: { ...CONTENT, experience: [{ ...CONTENT.experience[0]!, bullets: ["x".repeat(1_001)] }] },
        error: "Keep each bullet under 1,000 characters.",
      },
      { content: { ...CONTENT, skills: Array.from({ length: 51 }, (_, i) => `Skill ${i}`) }, error: "Keep each list under 50 items." },
      { content: { ...CONTENT, contact: { ...CONTENT.contact, name: "x".repeat(201) } }, error: "Keep each short field under 200 characters." },
    ];
    for (const { content, error } of cases) {
      const res = await save(cookie, id, { content, version: 1 });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error });
    }
    expect(await storedContent(id)).toEqual({ content: CONTENT, version: 1 });
  });
});
