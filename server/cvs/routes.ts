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
import { pdfToSource } from "../ingest/pdf.js";
import { createCv, deleteCv, getCv, listCvs } from "./repo.js";

const TargetRole = z
  .string()
  .trim()
  .min(TARGET_ROLE_MIN, `Enter a target role of at least ${TARGET_ROLE_MIN} characters.`)
  .max(TARGET_ROLE_MAX, `Keep the target role under ${TARGET_ROLE_MAX} characters.`);

const SOURCE_TEXT_TOO_LONG = `Keep your text under ${SOURCE_TEXT_MAX.toLocaleString("en-US")} characters.`;

const CreateCvBody = z.object({
  targetRole: TargetRole,
  sourceText: z
    .string()
    .trim()
    .min(SOURCE_TEXT_MIN, `Describe your background in at least ${SOURCE_TEXT_MIN} characters.`)
    .max(SOURCE_TEXT_MAX, SOURCE_TEXT_TOO_LONG),
});

const UploadFields = z.object({ targetRole: TargetRole });

type NewSource = { targetRole: string; sourceKind: "text" | "pdf"; sourceText: string };

async function readPdfUpload(app: FastifyInstance, request: FastifyRequest): Promise<NewSource> {
  const fields: Record<string, unknown> = {};
  let file: Buffer | undefined;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") file = await part.toBuffer();
      else fields[part.fieldname] = part.value;
    }
  } catch (err) {
    if (err instanceof app.multipartErrors.RequestFileTooLargeError) {
      throw new HttpError(413, "The file is larger than 5 MB.");
    }
    throw err;
  }
  const { targetRole } = parseBody(UploadFields, fields);
  if (file === undefined) throw new HttpError(400, "Choose a PDF file.");
  const sourceText = await pdfToSource(file);
  if (sourceText.length > SOURCE_TEXT_MAX) throw new HttpError(422, SOURCE_TEXT_TOO_LONG);
  return { targetRole, sourceKind: "pdf", sourceText };
}

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
    const source: NewSource = request.isMultipart()
      ? await readPdfUpload(app, request)
      : { ...parseBody(CreateCvBody, request.body), sourceKind: "text" };
    const id = await createCv(sql, { ownerId: user.id, ...source });
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
