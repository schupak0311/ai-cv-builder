import type { FastifyInstance } from "fastify";
import postgres from "postgres";
import { z } from "zod";
import type { Me } from "../../shared/api.js";
import type { Sql } from "../db.js";
import { HttpError, parseBody } from "../http.js";
import { hashPassword, verifyPassword } from "./password.js";
import { endSession, requireUser, startSession, type User } from "./sessions.js";

const Credentials = z.object({
  email: z.email("Enter a valid email address.").trim().max(254),
  password: z.string().min(8, "Use at least 8 characters for your password.").max(200),
});

const WRONG_CREDENTIALS = "Wrong email or password.";
// Compared against when the email is unknown, so a missing account costs the same scrypt time.
const DUMMY_HASH = await hashPassword("not-a-real-password");

export function authRoutes(app: FastifyInstance, sql: Sql): void {
  app.post("/api/auth/signup", async (request, reply) => {
    const { email, password } = parseBody(Credentials, request.body);
    const passwordHash = await hashPassword(password);
    let user: User | undefined;
    try {
      [user] = await sql<User[]>`
        insert into users (email, password_hash) values (${email}, ${passwordHash}) returning id, email
      `;
    } catch (err) {
      if (err instanceof postgres.PostgresError && err.code === "23505") {
        throw new HttpError(409, "An account with this email already exists.");
      }
      throw err;
    }
    if (user === undefined) throw new Error("Insert returned no user");
    await startSession(sql, reply, user.id);
    return reply.code(201).send({ id: user.id, email: user.email } satisfies Me);
  });

  app.post("/api/auth/login", async (request, reply) => {
    const { email, password } = parseBody(Credentials, request.body);
    const [row] = await sql<(User & { passwordHash: string })[]>`
      select id, email, password_hash from users where lower(email) = lower(${email})
    `;
    const ok = await verifyPassword(password, row?.passwordHash ?? DUMMY_HASH);
    if (row === undefined || !ok) throw new HttpError(401, WRONG_CREDENTIALS);
    await startSession(sql, reply, row.id);
    return { id: row.id, email: row.email } satisfies Me;
  });

  app.post("/api/auth/logout", async (request, reply) => {
    await endSession(sql, request, reply);
    return reply.code(204).send();
  });

  app.get("/api/me", async (request) => {
    const user = await requireUser(sql, request);
    return { id: user.id, email: user.email } satisfies Me;
  });
}
