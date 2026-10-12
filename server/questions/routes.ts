import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ANSWER_MAX } from "../../shared/api.js";
import { requireUser } from "../auth/sessions.js";
import type { Sql } from "../db.js";
import { HttpError, params, parseBody } from "../http.js";
import { answerQuestion } from "./repo.js";

const AnswerBody = z.object({
  answer: z
    .string()
    .trim()
    .min(1, "Write an answer first.")
    .max(ANSWER_MAX, `Keep the answer under ${ANSWER_MAX.toLocaleString("en-US")} characters.`),
});

const QUESTION_NOT_FOUND = "Question not found.";

export function questionRoutes(app: FastifyInstance, sql: Sql): void {
  app.post("/api/cvs/:id/questions/:questionId/answer", async (request, reply) => {
    const user = await requireUser(sql, request);
    const { id, questionId } = params(z.object({ id: z.uuid(), questionId: z.uuid() }), request, QUESTION_NOT_FOUND);
    const { answer } = parseBody(AnswerBody, request.body);
    const result = await answerQuestion(sql, { ownerId: user.id, cvId: id, questionId, answer });
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
