import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "../db.js";
import { HttpError } from "../http.js";

export type UserId = string & { readonly __brand: "UserId" };
export type User = { id: UserId; email: string };

export const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSession(sql: Sql, reply: FastifyReply, userId: UserId): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${hashToken(token)}, ${userId}, ${expiresAt})`;
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(sql: Sql, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (token !== undefined) await sql`delete from sessions where token_hash = ${hashToken(token)}`;
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function currentUser(sql: Sql, request: FastifyRequest): Promise<User | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (token === undefined) return null;
  const [user] = await sql<User[]>`
    select u.id, u.email from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.expires_at > now()
  `;
  return user ?? null;
}

export async function requireUser(sql: Sql, request: FastifyRequest): Promise<User> {
  const user = await currentUser(sql, request);
  if (user === null) throw new HttpError(401, "Log in to continue.");
  return user;
}
