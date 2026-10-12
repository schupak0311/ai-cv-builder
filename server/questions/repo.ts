import type { UserId } from "../auth/sessions.js";
import type { Sql } from "../db.js";

export type AnswerResult = "queued" | "not-found" | "no-content" | "busy" | "already-answered";

/** Locks the CV row, so two answers on one CV cannot both queue a job. */
export async function answerQuestion(
  sql: Sql,
  input: { ownerId: UserId; cvId: string; questionId: string; answer: string },
): Promise<AnswerResult> {
  return sql.begin(async (tx): Promise<AnswerResult> => {
    const [row] = await tx<{ hasContent: boolean; busy: boolean; answer: string | null }[]>`
      select
        c.content is not null as has_content,
        exists (select 1 from jobs j where j.cv_id = c.id and j.status in ('queued', 'running')) as busy,
        q.answer
      from cvs c join questions q on q.cv_id = c.id and q.id = ${input.questionId}
      where c.id = ${input.cvId} and c.owner_id = ${input.ownerId}
      for update of c
    `;
    if (row === undefined) return "not-found";
    if (!row.hasContent) return "no-content";
    if (row.busy) return "busy";
    if (row.answer !== null) return "already-answered";
    await tx`update questions set answer = ${input.answer}, answered_at = now() where id = ${input.questionId}`;
    await tx`
      insert into jobs (cv_id, kind, payload, status)
      values (${input.cvId}, 'revise', ${tx.json({ questionId: input.questionId })}, 'queued')
    `;
    return "queued";
  });
}
