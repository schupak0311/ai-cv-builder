import type { Env } from "../env.js";
import { createFakeLlm } from "./fake.js";
import { LlmError, type Llm } from "./llm.js";

export function createLlm(env: Env): Llm {
  switch (env.LLM_MODE) {
    case "fake":
      return createFakeLlm(env.FAKE_LLM_DELAY_MS);
    case "real":
      return {
        draft: () =>
          Promise.reject(new LlmError("The Claude model is not connected yet. Run with LLM_MODE=fake.", false)),
      };
    default: {
      const _exhaustive: never = env;
      return _exhaustive;
    }
  }
}
