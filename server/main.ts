import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { connect, migrate } from "./db.js";
import { parseEnv } from "./env.js";
import { requeueRunningJobs, runWorker } from "./jobs/worker.js";
import { createClaudeClient, createClaudeLlm } from "./llm/claude.js";

const env = (() => {
  try {
    return parseEnv(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
})();
const sql = connect(env.DATABASE_URL);
const app = await buildApp({ sql, webDir: resolve("dist/web"), logger: true });

const applied = await migrate(sql);
app.log.info({ applied }, "migrations applied");
const { requeued, failed } = await requeueRunningJobs(sql);
app.log.info({ requeued, failed }, "jobs requeued");

const llm = createClaudeLlm(createClaudeClient(env.ANTHROPIC_API_KEY), { model: env.CV_MODEL, effort: env.CV_EFFORT });
void runWorker({ sql, llm, log: app.log });
await app.listen({ host: "0.0.0.0", port: 8080 });

// Exit without waiting for an in-flight job: it stays `running` and the next boot requeues it.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().finally(() => process.exit(0));
  });
}
