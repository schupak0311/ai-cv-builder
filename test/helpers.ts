import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, expect } from "vitest";
import { buildApp } from "../server/app.js";
import { connect } from "../server/db.js";
import type { CvDraft } from "../server/llm/llm.js";
import { testDatabaseUrl } from "./database.js";

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

export const SOURCE = [
  "Anna Example",
  "anna@example.com",
  "+44 20 7946 0958",
  "Backend engineer with eight years of experience building payment systems.",
  "Led the migration of the billing service to PostgreSQL.",
  "Cut API latency by 40% by adding a caching layer.",
  "Skills: TypeScript, PostgreSQL, Kafka",
].join("\n");

/** What the model returns for `SOURCE`: every Claim quotes a Source line as its Evidence. */
export const SOURCE_DRAFT: CvDraft = {
  contact: { name: "Anna Example", email: "anna@example.com", phone: "+44 20 7946 0958", location: null, links: [] },
  summary: [
    {
      text: "Backend engineer with eight years of experience building payment systems.",
      evidence: ["Backend engineer with eight years of experience building payment systems."],
    },
  ],
  experience: [
    {
      employer: null,
      title: null,
      location: null,
      start: null,
      end: null,
      bullets: [
        {
          text: "Led the migration of the billing service to PostgreSQL.",
          evidence: ["Led the migration of the billing service to PostgreSQL."],
        },
        {
          text: "Cut API latency by 40% by adding a caching layer.",
          evidence: ["Cut API latency by 40% by adding a caching layer."],
        },
      ],
      evidence: [],
    },
  ],
  education: [],
  skills: ["TypeScript", "PostgreSQL", "Kafka"],
  questions: [{ section: "summary", text: "What makes you a strong fit for the Senior Backend Engineer role?" }],
};

export async function createCv(app: FastifyInstance, cookie: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/cvs",
    headers: { cookie },
    payload: { targetRole: "Senior Backend Engineer", sourceText: SOURCE },
  });
  expect(res.statusCode).toBe(201);
  const { id } = res.json<{ id: string }>();
  return id;
}
