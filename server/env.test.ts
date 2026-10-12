import { expect, test } from "vitest";
import { parseEnv } from "./env.js";

test("the real model is the default and needs an API key", () => {
  expect(() => parseEnv({ DATABASE_URL: "postgres://db/cv" })).toThrow("Set ANTHROPIC_API_KEY in .env");
  expect(() => parseEnv({ DATABASE_URL: "postgres://db/cv", ANTHROPIC_API_KEY: "" })).toThrow("Set ANTHROPIC_API_KEY in .env");
  expect(parseEnv({ DATABASE_URL: "postgres://db/cv", ANTHROPIC_API_KEY: "sk-test" })).toEqual({
    LLM_MODE: "real",
    DATABASE_URL: "postgres://db/cv",
    ANTHROPIC_API_KEY: "sk-test",
  });
});

test("the fake model needs no key and reads its delay", () => {
  expect(parseEnv({ DATABASE_URL: "postgres://db/cv", LLM_MODE: "fake", FAKE_LLM_DELAY_MS: "8000" })).toEqual({
    LLM_MODE: "fake",
    DATABASE_URL: "postgres://db/cv",
    FAKE_LLM_DELAY_MS: 8000,
  });
});
