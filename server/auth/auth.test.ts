import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sessionCookie, signUp, useTestApp } from "../../test/helpers.js";

const ctx = useTestApp();

async function me(cookie?: string) {
  const app = await ctx.app();
  return app.inject({ method: "GET", url: "/api/me", headers: cookie === undefined ? {} : { cookie } });
}

describe("auth", () => {
  test("sign up starts a session with an HttpOnly cookie whose hash is stored", async () => {
    const app = await ctx.app();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "anna@example.com", password: "correct horse" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: "anna@example.com" });
    const sid = res.cookies.find((c) => c.name === "sid");
    expect(sid).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
    expect(sid?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [session] = await ctx.sql<{ tokenHash: string }[]>`select token_hash from sessions`;
    expect(session?.tokenHash).toBe(createHash("sha256").update(sid?.value ?? "").digest("hex"));

    const meRes = await me(sessionCookie(res.cookies));
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json()).toMatchObject({ email: "anna@example.com" });
  });

  test("sign up with an email that already exists, in any case, is a conflict", async () => {
    const app = await ctx.app();
    await signUp(app, "anna@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "Anna@Example.com", password: "another password" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "An account with this email already exists." });
  });

  test("log in with the right password starts a session", async () => {
    const app = await ctx.app();
    await signUp(app, "anna@example.com", "correct horse");
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "ANNA@example.com", password: "correct horse" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: "anna@example.com" });
    expect((await me(sessionCookie(res.cookies))).json()).toMatchObject({ email: "anna@example.com" });
  });

  test("a wrong password and an unknown email get the same 401", async () => {
    const app = await ctx.app();
    await signUp(app, "anna@example.com", "correct horse");
    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "anna@example.com", password: "battery staple" },
    });
    const unknownEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.com", password: "correct horse" },
    });
    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Wrong email or password." });
      expect(res.cookies).toEqual([]);
    }
  });

  test("log out ends the session", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "anna@example.com");
    const res = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(res.statusCode).toBe(204);
    expect((await me(cookie)).statusCode).toBe(401);
    expect(await ctx.sql`select 1 from sessions`).toHaveLength(0);
  });

  test("GET /api/me without a cookie is a 401", async () => {
    const res = await me();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Log in to continue." });
  });

  test("sign up rejects a short password", async () => {
    const app = await ctx.app();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email: "anna@example.com", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Use at least 8 characters for your password." });
  });
});
