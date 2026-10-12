import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, expect } from "vitest";
import { buildApp } from "../server/app.js";
import { connect } from "../server/db.js";
import { testDatabaseUrl } from "./database.js";

/** Gives each test a fresh, empty database and an app driven through `inject`. */
export function useTestApp() {
  const sql = connect(testDatabaseUrl());
  const appPromise = buildApp({ sql });
  beforeEach(async () => {
    await sql`truncate users, sessions, cvs, questions, jobs cascade`;
  });
  afterAll(async () => {
    await (await appPromise).close();
    await sql.end();
  });
  return { sql, app: () => appPromise };
}

export async function signUp(app: FastifyInstance, email: string, password = "correct horse"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/auth/signup", payload: { email, password } });
  expect(res.statusCode).toBe(201);
  return sessionCookie(res.cookies);
}

export function sessionCookie(cookies: { name: string; value: string }[]): string {
  const sid = cookies.find((c) => c.name === "sid");
  if (sid === undefined) throw new Error("No sid cookie in response");
  return `sid=${sid.value}`;
}
