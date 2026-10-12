import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/sessions.js";
import { CV_NOT_FOUND, cvIdParam } from "../cvs/routes.js";
import type { Sql } from "../db.js";
import { HttpError } from "../http.js";
import { retryLatestJob } from "./repo.js";

export function jobRoutes(app: FastifyInstance, sql: Sql): void {
  app.post("/api/cvs/:id/retry", async (request, reply) => {
    const user = await requireUser(sql, request);
    const result = await retryLatestJob(sql, { ownerId: user.id, cvId: cvIdParam(request) });
    switch (result) {
      case "queued":
        return reply.code(202).send();
      case "not-found":
        throw new HttpError(404, CV_NOT_FOUND);
      case "nothing-to-retry":
        throw new HttpError(409, "Nothing to retry.");
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  });
}
