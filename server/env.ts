import { z } from "zod";

const MISSING_KEY = "Set ANTHROPIC_API_KEY in .env";

const Env = z.discriminatedUnion("LLM_MODE", [
  z.object({
    LLM_MODE: z.literal("real"),
    DATABASE_URL: z.string().min(1),
    ANTHROPIC_API_KEY: z.string({ error: MISSING_KEY }).min(1, MISSING_KEY),
    ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5-5"),
    ANTHROPIC_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  }),
  z.object({
    LLM_MODE: z.literal("fake"),
    DATABASE_URL: z.string().min(1),
    FAKE_LLM_DELAY_MS: z.coerce.number().int().min(0).default(3000),
  }),
]);

export type Env = z.infer<typeof Env>;

/** Throws an error whose message is one readable line per problem, fit to print at boot. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = Env.safeParse({ ...source, LLM_MODE: source.LLM_MODE ?? "real" });
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => {
    const name = issue.path.join(".");
    return issue.message.includes(name) ? issue.message : `${name}: ${issue.message}`;
  });
  throw new Error(lines.join("\n"));
}
