import type { Env } from "../env.js";
import { createClaudeClient, createClaudeLlm } from "./claude.js";
import { createFakeLlm } from "./fake.js";
import type { Llm } from "./llm.js";

export function createLlm(env: Env): Llm {
  switch (env.LLM_MODE) {
    case "fake":
      return createFakeLlm(env.FAKE_LLM_DELAY_MS);
    case "real":
      return createClaudeLlm(createClaudeClient(env.ANTHROPIC_API_KEY), {
        model: env.ANTHROPIC_MODEL,
        effort: env.ANTHROPIC_EFFORT,
      });
    default: {
      const _exhaustive: never = env;
      return _exhaustive;
    }
  }
}
