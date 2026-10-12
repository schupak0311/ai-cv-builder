import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { connect, migrate } from "./db.js";
import { parseEnv } from "./env.js";

const env = parseEnv(process.env);
const sql = connect(env.DATABASE_URL);
const app = await buildApp({ sql, webDir: resolve("dist/web"), logger: true });

const applied = await migrate(sql);
app.log.info({ applied, llmMode: env.LLM_MODE }, "migrations applied");

await app.listen({ host: "0.0.0.0", port: 8080 });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().finally(() => process.exit(0));
  });
}
