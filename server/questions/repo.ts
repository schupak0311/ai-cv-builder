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
