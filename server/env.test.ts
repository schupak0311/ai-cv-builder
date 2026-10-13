import { expect, test } from "vitest";
import { parseEnv } from "./env.js";

test("an API key is required and the model and effort have defaults", () => {
  expect(() => parseEnv({ DATABASE_URL: "postgres://db/cv" })).toThrow(new Error("Set ANTHROPIC_API_KEY in .env"));
  expect(() => parseEnv({ DATABASE_URL: "postgres://db/cv", ANTHROPIC_API_KEY: "" })).toThrow(
    new Error("Set ANTHROPIC_API_KEY in .env"),
  );
  expect(parseEnv({ DATABASE_URL: "postgres://db/cv", ANTHROPIC_API_KEY: "sk-test" })).toEqual({
    DATABASE_URL: "postgres://db/cv",
    ANTHROPIC_API_KEY: "sk-test",
    CV_MODEL: "claude-opus-5-5",
    CV_EFFORT: "medium",
  });
});

test("the model and its effort can be overridden", () => {
  const base = { DATABASE_URL: "postgres://db/cv", ANTHROPIC_API_KEY: "sk-test" };
  expect(parseEnv({ ...base, CV_MODEL: "claude-sonnet-5-5", CV_EFFORT: "low" })).toMatchObject({
    CV_MODEL: "claude-sonnet-5-5",
    CV_EFFORT: "low",
  });
  expect(() => parseEnv({ ...base, CV_EFFORT: "max" })).toThrow(
    new Error('CV_EFFORT: Invalid option: expected one of "low"|"medium"|"high"'),
  );
});
