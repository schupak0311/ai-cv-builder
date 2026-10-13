import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ANSWER_MAX, ANSWERS_MAX } from "../../shared/api.js";
import { requireUser } from "../auth/sessions.js";
import type { Sql } from "../db.js";
import { HttpError, params, parseBody } from "../http.js";
import { answerQuestions } from "./repo.js";

const AnswersBody = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        answer: z
          .string()
          .trim()
          .min(1, "Write an answer first.")
          .max(ANSWER_MAX, `Keep the answer under ${ANSWER_MAX.toLocaleString("en-US")} characters.`),
      }),
    )
    .min(1, "Write an answer first.")
    .max(ANSWERS_MAX, `Send at most ${ANSWERS_MAX} answers at a time.`)
    .refine((answers) => new Set(answers.map((a) => a.questionId)).size === answers.length, "Answer each question only once."),
});

const QUESTION_NOT_FOUND = "Question not found.";
const QuestionId = z.uuid();

export function questionRoutes(app: FastifyInstance, sql: Sql): void {
  app.post("/api/cvs/:id/answers", async (request, reply) => {
    const user = await requireUser(sql, request);
    const { id } = params(z.object({ id: z.uuid() }), request, QUESTION_NOT_FOUND);
    const { answers } = parseBody(AnswersBody, request.body);
    if (!answers.every((a) => QuestionId.safeParse(a.questionId).success)) throw new HttpError(404, QUESTION_NOT_FOUND);
    const result = await answerQuestions(sql, { ownerId: user.id, cvId: id, answers });
    switch (result) {
      case "queued":
        return reply.code(202).send();
      case "not-found":
        throw new HttpError(404, QUESTION_NOT_FOUND);
      case "no-content":
        throw new HttpError(409, "This CV has no content to update yet.");
      case "already-answered":
        throw new HttpError(409, "This question already has an answer.");
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  });
}
