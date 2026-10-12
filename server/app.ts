import { existsSync } from "node:fs";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import postgres from "postgres";
import { PDF_MAX_BYTES } from "../shared/api.js";
import { authRoutes } from "./auth/routes.js";
import { cvRoutes } from "./cvs/routes.js";
import type { Sql } from "./db.js";
import { HttpError, JOB_ACTIVE } from "./http.js";
import { jobRoutes } from "./jobs/routes.js";
import { questionRoutes } from "./questions/routes.js";

export async function buildApp(options: {
  sql: Sql;
  webDir?: string;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024 });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { files: 1, fileSize: PDF_MAX_BYTES, fields: 4, fieldSize: 1024, parts: 5 },
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof postgres.PostgresError && err.constraint_name === "jobs_one_active_per_cv") {
      return reply.code(409).send({ error: JOB_ACTIVE });
    }
    const status = typeof err === "object" && err !== null && "statusCode" in err ? err.statusCode : undefined;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "Invalid request." });
    }
    request.log.error({ err }, "request failed");
    return reply.code(500).send({ error: "Something went wrong. Try again." });
  });

  authRoutes(app, options.sql);
  cvRoutes(app, options.sql);
  questionRoutes(app, options.sql);
  jobRoutes(app, options.sql);

  const webDir = options.webDir;
  const servesWeb = webDir !== undefined && existsSync(webDir);
  if (servesWeb) await app.register(fastifyStatic, { root: webDir, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (servesWeb && request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found." });
  });

  return app;
}
