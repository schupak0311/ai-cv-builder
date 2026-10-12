import { expect, test } from "vitest";
import { parseEnv } from "./env.js";

test("the real model is the default and needs an API key", () => {
  expect(() => parseEnv({ DATABASE_URL: "postgres://db/cv" })).toThrow(new Error("Set ANTHROPIC_API_KEY in .env"));
  expect(() => parseEnv({ DATABASE_URL: "postgres://db/cv", ANTHROPIC_API_KEY: "" })).toThrow(
    new Error("Set ANTHROPIC_API_KEY in .env"),
  );
  expect(parseEnv({ DATABASE_URL: "postgres://db/cv", ANTHROPIC_API_KEY: "sk-test" })).toEqual({
    LLM_MODE: "real",
    DATABASE_URL: "postgres://db/cv",
    ANTHROPIC_API_KEY: "sk-test",
    ANTHROPIC_MODEL: "claude-opus-5-5",
    ANTHROPIC_EFFORT: "medium",
  });
});

test("the real model and its effort can be overridden", () => {
  const base = { DATABASE_URL: "postgres://db/cv", ANTHROPIC_API_KEY: "sk-test" };
  expect(parseEnv({ ...base, ANTHROPIC_MODEL: "claude-sonnet-5-5", ANTHROPIC_EFFORT: "low" })).toMatchObject({
    ANTHROPIC_MODEL: "claude-sonnet-5-5",
    ANTHROPIC_EFFORT: "low",
  });
  expect(() => parseEnv({ ...base, ANTHROPIC_EFFORT: "max" })).toThrow(
    new Error('ANTHROPIC_EFFORT: Invalid option: expected one of "low"|"medium"|"high"'),
  );
});

test("the fake model needs no key and reads its delay", () => {
  expect(parseEnv({ DATABASE_URL: "postgres://db/cv", LLM_MODE: "fake", FAKE_LLM_DELAY_MS: "8000" })).toEqual({
    LLM_MODE: "fake",
    DATABASE_URL: "postgres://db/cv",
    FAKE_LLM_DELAY_MS: 8000,
  });
});
