import { z } from "zod";

const MISSING_KEY = "Set ANTHROPIC_API_KEY in .env";

const Env = z.discriminatedUnion("LLM_MODE", [
  z.object({
    LLM_MODE: z.literal("real"),
    DATABASE_URL: z.string().min(1),
    ANTHROPIC_API_KEY: z.string({ error: MISSING_KEY }).min(1, MISSING_KEY),
  }),
  z.object({
    LLM_MODE: z.literal("fake"),
    DATABASE_URL: z.string().min(1),
    FAKE_LLM_DELAY_MS: z.coerce.number().int().min(0).default(3000),
  }),
]);

export type Env = z.infer<typeof Env>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  return Env.parse({ ...source, LLM_MODE: source.LLM_MODE ?? "real" });
}
