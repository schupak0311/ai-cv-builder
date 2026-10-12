import type { JSONValue } from "postgres";
import type { UserId } from "../auth/sessions.js";
import type { Sql } from "../db.js";

export type AnswerResult = "queued" | "not-found" | "no-content" | "already-answered";

/** A second active job on the CV fails the insert on `jobs_one_active_per_cv`, which the app maps to 409. */
export async function answerQuestion(
  sql: Sql,
  input: { ownerId: UserId; cvId: string; questionId: string; answer: string },
): Promise<AnswerResult> {
  return sql.begin(async (tx): Promise<AnswerResult> => {
    const [row] = await tx<{ hasContent: boolean; answer: string | null }[]>`
      select c.content is not null as has_content, q.answer
      from cvs c join questions q on q.cv_id = c.id and q.id = ${input.questionId}
      where c.id = ${input.cvId} and c.owner_id = ${input.ownerId}
    `;
    if (row === undefined) return "not-found";
    if (!row.hasContent) return "no-content";
    if (row.answer !== null) return "already-answered";
    await tx`
      insert into jobs (cv_id, kind, payload, status)
      values (${input.cvId}, 'revise', ${tx.json({ questionId: input.questionId, answer: input.answer })}, 'queued')
    `;
    return "queued";
  });
}

export type RetryResult = "queued" | "not-found" | "nothing-to-retry";

export async function retryLatestJob(sql: Sql, input: { ownerId: UserId; cvId: string }): Promise<RetryResult> {
  return sql.begin(async (tx): Promise<RetryResult> => {
    const owned = await tx`select id from cvs where id = ${input.cvId} and owner_id = ${input.ownerId} for update`;
    if (owned.length === 0) return "not-found";
    const [latest] = await tx<{ kind: string; payload: JSONValue; status: string }[]>`
      select kind, payload, status from jobs where cv_id = ${input.cvId} order by created_at desc limit 1
    `;
    if (latest?.status !== "failed") return "nothing-to-retry";
    await tx`
      insert into jobs (cv_id, kind, payload, status)
      values (${input.cvId}, ${latest.kind}, ${tx.json(latest.payload)}, 'queued')
    `;
    return "queued";
  });
}
