import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CV_EDIT_BULLET_MAX,
  CV_EDIT_LIST_MAX,
  CV_EDIT_SHORT_MAX,
  CV_EDIT_SUMMARY_MAX,
  type SavedCv,
  SOURCE_TEXT_MAX,
  SOURCE_TEXT_MIN,
  TARGET_ROLE_MAX,
  TARGET_ROLE_MIN,
} from "../../shared/api.js";
import { Cv } from "../../shared/cv.js";
import { requireUser } from "../auth/sessions.js";
import type { Sql } from "../db.js";
import { HttpError, parseBody } from "../http.js";
import { pdfToSource } from "../ingest/pdf.js";
import { createCv, deleteCv, getCv, listCvs, saveCvContent } from "./repo.js";

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
const NO_CONTENT = "This CV has no content yet.";

const shortText = z.string().max(CV_EDIT_SHORT_MAX, `Keep each short field under ${CV_EDIT_SHORT_MAX} characters.`);
const nullableShort = shortText.nullable();
function list<T extends z.ZodType>(item: T) {
  return z.array(item).max(CV_EDIT_LIST_MAX, `Keep each list under ${CV_EDIT_LIST_MAX} items.`);
}

const EditedCv = Cv.extend({
  contact: Cv.shape.contact.extend({
    name: nullableShort,
    email: nullableShort,
    phone: nullableShort,
    location: nullableShort,
    links: list(shortText),
  }),
  summary: z
    .string()
    .max(CV_EDIT_SUMMARY_MAX, `Keep the summary under ${CV_EDIT_SUMMARY_MAX.toLocaleString("en-US")} characters.`),
  experience: list(
    Cv.shape.experience.element.extend({
      id: shortText,
      employer: nullableShort,
      title: nullableShort,
      location: nullableShort,
      start: nullableShort,
      end: nullableShort,
      bullets: list(
        z.string().max(CV_EDIT_BULLET_MAX, `Keep each bullet under ${CV_EDIT_BULLET_MAX.toLocaleString("en-US")} characters.`),
      ),
    }),
  ),
  education: list(
    Cv.shape.education.element.extend({
      id: shortText,
      institution: nullableShort,
      degree: nullableShort,
      start: nullableShort,
      end: nullableShort,
    }),
  ),
  skills: list(shortText),
});

const SaveCvBody = z.object({ content: EditedCv, version: z.number().int() });

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

  app.put("/api/cvs/:id", async (request): Promise<SavedCv> => {
    const user = await requireUser(sql, request);
    const id = cvIdParam(request);
    const { content, version } = parseBody(SaveCvBody, request.body);
    const result = await saveCvContent(sql, { ownerId: user.id, id, content, version });
    switch (result.kind) {
      case "saved":
        return { version: result.version };
      case "not-found":
        throw new HttpError(404, CV_NOT_FOUND);
      case "no-content":
        throw new HttpError(409, NO_CONTENT);
      case "job-active":
        throw new HttpError(409, "Wait for the current update to finish.");
      case "stale":
        throw new HttpError(409, "This CV changed somewhere else. Reload to get the latest version.");
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  });

  app.delete("/api/cvs/:id", async (request, reply) => {
    const user = await requireUser(sql, request);
    if (!(await deleteCv(sql, user.id, cvIdParam(request)))) throw new HttpError(404, CV_NOT_FOUND);
    return reply.code(204).send();
  });
}
