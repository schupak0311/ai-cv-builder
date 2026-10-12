import { existsSync } from "node:fs";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { authRoutes } from "./auth/routes.js";
import type { Sql } from "./db.js";
import { HttpError } from "./http.js";

export async function buildApp(options: {
  sql: Sql;
  webDir?: string;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024 });
  await app.register(cookie);

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status = typeof err === "object" && err !== null && "statusCode" in err ? err.statusCode : undefined;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "Invalid request." });
    }
    request.log.error({ err }, "request failed");
    return reply.code(500).send({ error: "Something went wrong. Try again." });
  });

  authRoutes(app, options.sql);

  const webDir = options.webDir;
  if (webDir !== undefined && existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
  }
  app.setNotFoundHandler((request, reply) => {
    if (webDir !== undefined && request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found." });
  });

  return app;
}
