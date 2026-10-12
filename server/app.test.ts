import { expect, test } from "vitest";
import { useTestApp } from "../test/helpers.js";
import { buildApp } from "./app.js";

const ctx = useTestApp();

test("an unknown page is a 404 when the web build is missing", async () => {
  const app = await buildApp({ sql: ctx.sql, webDir: "/nonexistent/dist/web" });
  const res = await app.inject({ method: "GET", url: "/cvs/new" });
  await app.close();
  expect(res.statusCode).toBe(404);
  expect(res.json()).toEqual({ error: "Not found." });
});
