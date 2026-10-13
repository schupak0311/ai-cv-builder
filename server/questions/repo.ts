import type { UserId } from "../auth/sessions.js";
import type { Sql } from "../db.js";

export type AnswerResult = "queued" | "not-found" | "no-content" | "already-answered";

export type NewAnswer = { questionId: string; answer: string };

/** A second active job on the CV fails the insert on `jobs_one_active_per_cv`, which the app maps to 409. */
export async function answerQuestions(
  sql: Sql,
  input: { ownerId: UserId; cvId: string; answers: NewAnswer[] },
): Promise<AnswerResult> {
  return sql.begin(async (tx): Promise<AnswerResult> => {
    const ids = input.answers.map((a) => a.questionId);
    const [cv] = await tx<{ hasContent: boolean }[]>`
      select content is not null as has_content from cvs where id = ${input.cvId} and owner_id = ${input.ownerId}
    `;
    if (cv === undefined) return "not-found";
    const questions = await tx<{ answer: string | null }[]>`
      select answer from questions where cv_id = ${input.cvId} and id = any(${tx.array(ids)}::uuid[])
    `;
    if (questions.length !== ids.length) return "not-found";
    if (!cv.hasContent) return "no-content";
    if (questions.some((q) => q.answer !== null)) return "already-answered";
    await tx`
      insert into jobs (cv_id, kind, payload, status)
      values (${input.cvId}, 'revise', ${tx.json({ answers: input.answers })}, 'queued')
    `;
    return "queued";
  });
}
