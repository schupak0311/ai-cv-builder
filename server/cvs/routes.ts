import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  SOURCE_TEXT_MAX,
  SOURCE_TEXT_MIN,
  TARGET_ROLE_MAX,
  TARGET_ROLE_MIN,
} from "../../shared/api.js";
import { requireUser } from "../auth/sessions.js";
import type { Sql } from "../db.js";
import { HttpError, parseBody } from "../http.js";
import { createCvFromText, deleteCv, getCv, listCvs } from "./repo.js";

const CreateCvBody = z.object({
  targetRole: z
    .string()
    .trim()
    .min(TARGET_ROLE_MIN, `Enter a target role of at least ${TARGET_ROLE_MIN} characters.`)
    .max(TARGET_ROLE_MAX, `Keep the target role under ${TARGET_ROLE_MAX} characters.`),
  sourceText: z
    .string()
    .trim()
    .min(SOURCE_TEXT_MIN, `Describe your background in at least ${SOURCE_TEXT_MIN} characters.`)
    .max(SOURCE_TEXT_MAX, `Keep your text under ${SOURCE_TEXT_MAX.toLocaleString("en-US")} characters.`),
});

const CV_NOT_FOUND = "CV not found.";

function cvIdParam(request: FastifyRequest): string {
  const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
  if (!parsed.success) throw new HttpError(404, CV_NOT_FOUND);
  return parsed.data.id;
}

export function cvRoutes(app: FastifyInstance, sql: Sql): void {
  app.get("/api/cvs", async (request) => {
    const user = await requireUser(sql, request);
    return listCvs(sql, user.id);
  });

  app.post("/api/cvs", async (request, reply) => {
    const user = await requireUser(sql, request);
    const body = parseBody(CreateCvBody, request.body);
    const id = await createCvFromText(sql, { ownerId: user.id, ...body });
    return reply.code(201).send({ id });
  });

  app.get("/api/cvs/:id", async (request) => {
    const user = await requireUser(sql, request);
    const cv = await getCv(sql, user.id, cvIdParam(request));
    if (cv === null) throw new HttpError(404, CV_NOT_FOUND);
    return cv;
  });

  app.delete("/api/cvs/:id", async (request, reply) => {
    const user = await requireUser(sql, request);
    if (!(await deleteCv(sql, user.id, cvIdParam(request)))) throw new HttpError(404, CV_NOT_FOUND);
    return reply.code(204).send();
  });
}
