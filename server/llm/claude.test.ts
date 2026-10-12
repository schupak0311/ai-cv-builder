import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import { createClaudeLlm, type MessagesClient } from "./claude.js";
import type { CvDraft } from "./llm.js";

const DRAFT: CvDraft = {
  contact: { name: "Tomasz Nowak", email: null, phone: null, location: null, links: [] },
  summary: [],
  experience: [],
  education: [],
  skills: ["Swift"],
  questions: [{ section: "contact", text: "What is your phone number?" }],
};

function message(part: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: "msg_1",
    container: null,
    content: [{ type: "text", text: JSON.stringify(DRAFT), citations: null }],
    diagnostics: null,
    model: "claude-opus-5-5",
    role: "assistant",
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    type: "message",
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 900,
      output_tokens: 400,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
    },
    ...part,
  };
}

function stub(reply: () => Promise<Anthropic.Message>) {
  const bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      create(body) {
        bodies.push(body);
        return reply();
      },
    },
  };
  return { llm: createClaudeLlm(client, { model: "claude-opus-5-5", effort: "medium" }), bodies };
}

const input = { targetRole: "iOS Developer", source: "Tomasz Nowak\nSkills: Swift" };
const headers = new Headers();

describe("Claude client", () => {
  test("a finished reply is parsed into a draft from one request with no tools", async () => {
    const { llm, bodies } = stub(() => Promise.resolve(message({})));
    expect(await llm.draft(input)).toEqual(DRAFT);
    expect(bodies).toHaveLength(1);
    const [body] = bodies;
    expect({
      model: body?.model,
      max_tokens: body?.max_tokens,
      effort: body?.output_config?.effort,
      format: body?.output_config?.format?.type,
      tools: body?.tools,
      user: body?.messages[0]?.content,
    }).toEqual({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      effort: "medium",
      format: "json_schema",
      tools: undefined,
      user: "Target role: iOS Developer\n\n<source_document>\nTomasz Nowak\nSkills: Swift\n</source_document>\n\nDraft the CV for the target role from the source document above.",
    });
  });

  test.each<{ name: string; reply: () => Promise<Anthropic.Message>; message: string; retryable: boolean }>([
    {
      name: "a refusal",
      reply: () => Promise.resolve(message({ stop_reason: "refusal", content: [] })),
      message: "Claude declined to process this CV.",
      retryable: false,
    },
    {
      name: "a reply cut off at max_tokens",
      reply: () =>
        Promise.resolve(
          message({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"contact":{"na', citations: null }] }),
        ),
      message: "The draft was cut off.",
      retryable: true,
    },
    {
      name: "a reply with no text",
      reply: () => Promise.resolve(message({ content: [] })),
      message: "Claude returned a draft in the wrong shape.",
      retryable: true,
    },
    {
      name: "a reply that does not match the draft schema",
      reply: () => Promise.resolve(message({ content: [{ type: "text", text: '{"contact":null}', citations: null }] })),
      message: "Claude returned a draft in the wrong shape.",
      retryable: true,
    },
    {
      name: "a rate limit",
      reply: () => Promise.reject(new Anthropic.RateLimitError(429, undefined, "rate_limit_error", headers)),
      message: "Claude is busy right now. Try again in a minute.",
      retryable: true,
    },
    {
      name: "an overloaded API",
      reply: () => Promise.reject(new Anthropic.InternalServerError(529, undefined, "overloaded_error", headers)),
      message: "Claude is having trouble right now. Try again in a minute.",
      retryable: true,
    },
    {
      name: "a timeout",
      reply: () => Promise.reject(new Anthropic.APIConnectionTimeoutError()),
      message: "Could not reach Claude. Trying again.",
      retryable: true,
    },
    {
      name: "a rejected API key",
      reply: () => Promise.reject(new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", headers)),
      message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.",
      retryable: false,
    },
    {
      name: "an unknown model",
      reply: () => Promise.reject(new Anthropic.NotFoundError(404, undefined, "model: claude-x", headers)),
      message: "The Claude model was not found. Check CV_MODEL.",
      retryable: false,
    },
  ])("$name surfaces as an LlmError", async ({ reply, message: expected, retryable }) => {
    const { llm } = stub(reply);
    await expect(llm.draft(input)).rejects.toMatchObject({ name: "LlmError", message: expected, retryable });
  });
});
