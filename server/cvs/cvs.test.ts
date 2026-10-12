import { describe, expect, test } from "vitest";
import { createCv, SOURCE, signUp, useTestApp } from "../../test/helpers.js";

const ctx = useTestApp();

describe("CVs", () => {
  test("creating a CV from text queues a draft job", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await createCv(app, cookie);

    const res = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id,
      targetRole: "Senior Backend Engineer",
      content: null,
      version: 1,
      job: { kind: "generate", status: "queued" },
      error: null,
      questions: [],
    });
    const list = await app.inject({ method: "GET", url: "/api/cvs", headers: { cookie } });
    expect(list.json()).toMatchObject([{ id, targetRole: "Senior Backend Engineer", status: "queued" }]);
  });

  test("text outside the limits is rejected", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const cases = [
      { body: { targetRole: "Senior Backend Engineer", sourceText: "Too short." }, error: "Describe your background in at least 50 characters." },
      { body: { targetRole: "Senior Backend Engineer", sourceText: "x".repeat(20_001) }, error: "Keep your text under 20,000 characters." },
      { body: { targetRole: "X", sourceText: SOURCE }, error: "Enter a target role of at least 2 characters." },
      { body: { targetRole: "x".repeat(121), sourceText: SOURCE }, error: "Keep the target role under 120 characters." },
    ];
    for (const { body, error } of cases) {
      const res = await app.inject({ method: "POST", url: "/api/cvs", headers: { cookie }, payload: body });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error });
    }
    expect(await ctx.sql`select 1 from cvs`).toHaveLength(0);
  });

  test("a NUL character in pasted text is removed instead of failing the request", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/api/cvs",
      headers: { cookie },
      payload: { targetRole: "Senior\u0000 Backend Engineer", sourceText: `${SOURCE}\u0000` },
    });
    expect(res.statusCode).toBe(201);
    expect(await ctx.sql`select target_role, source_text from cvs`).toEqual([
      { targetRole: "Senior Backend Engineer", sourceText: SOURCE },
    ]);
  });

  test("CV routes need a session", async () => {
    const app = await ctx.app();
    const res = await app.inject({ method: "GET", url: "/api/cvs" });
    expect(res.statusCode).toBe(401);
  });

  test("another user gets 404 for someone else's CV on every route", async () => {
    const app = await ctx.app();
    const anna = await signUp(app, "anna@example.com");
    const bob = await signUp(app, "bob@example.com");
    const id = await createCv(app, anna);

    const get = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie: bob } });
    expect(get.statusCode).toBe(404);
    expect(get.json()).toEqual({ error: "CV not found." });

    const del = await app.inject({ method: "DELETE", url: `/api/cvs/${id}`, headers: { cookie: bob } });
    expect(del.statusCode).toBe(404);
    expect(del.json()).toEqual({ error: "CV not found." });

    const bobList = await app.inject({ method: "GET", url: "/api/cvs", headers: { cookie: bob } });
    expect(bobList.json()).toEqual([]);

    const annaGet = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie: anna } });
    expect(annaGet.statusCode).toBe(200);
  });

  test("the owner can delete a CV", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const id = await createCv(app, cookie);
    const del = await app.inject({ method: "DELETE", url: `/api/cvs/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
    const get = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie } });
    expect(get.statusCode).toBe(404);
  });

  test("a malformed CV id is a 404", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const res = await app.inject({ method: "GET", url: "/api/cvs/not-a-uuid", headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });
});
