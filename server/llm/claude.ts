import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Env } from "../env.js";
import { CvDraft, LlmError, type Llm } from "./llm.js";
import { buildPrompt, buildRevisePrompt } from "./prompt.js";

type RealEnv = Extract<Env, { LLM_MODE: "real" }>;
export type ClaudeOptions = { model: string; effort: RealEnv["ANTHROPIC_EFFORT"] };

/** The one SDK call this module makes, so tests can pass a stub without the network. */
export type MessagesClient = {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
};

const FORMAT = zodOutputFormat(CvDraft);
const WRONG_SHAPE = "Claude returned a draft in the wrong shape.";

function toLlmError(err: unknown): unknown {
  if (err instanceof Anthropic.RateLimitError) return new LlmError("Claude is busy right now. Try again in a minute.", true);
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("Could not reach Claude. Trying again.", true);
  if (err instanceof Anthropic.InternalServerError) return new LlmError("Claude is having trouble right now. Try again in a minute.", true);
  if (err instanceof Anthropic.AuthenticationError) return new LlmError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.", false);
  if (err instanceof Anthropic.PermissionDeniedError) return new LlmError("The Anthropic API key may not use this model.", false);
  if (err instanceof Anthropic.NotFoundError) return new LlmError("The Claude model was not found. Check ANTHROPIC_MODEL.", false);
  if (err instanceof Anthropic.BadRequestError) return new LlmError("Claude rejected the request for this CV.", false);
  return err;
}

/**
 * Uses `create` with the structured-output format rather than `parse`: `parse` throws on a cut-off
 * body before the caller can see `stop_reason`, which hides refusals and truncation behind one error.
 */
export async function requestDraft(
  client: MessagesClient,
  { model, effort }: ClaudeOptions,
  { system, user }: { system: string; user: string },
): Promise<{ draft: CvDraft; usage: Anthropic.Usage }> {
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort, format: FORMAT },
    });
  } catch (err) {
    throw toLlmError(err);
  }

  switch (message.stop_reason) {
    case "refusal":
      throw new LlmError("Claude declined to process this CV.", false);
    case "max_tokens":
      throw new LlmError("The draft was cut off.", true);
    case "model_context_window_exceeded":
      throw new LlmError("This CV is too long for Claude to draft.", false);
    case "end_turn":
    case "stop_sequence":
    case "tool_use":
    case "pause_turn":
    case null:
      break;
    default: {
      const _exhaustive: never = message.stop_reason;
      throw new LlmError(`Claude stopped for an unknown reason: ${String(_exhaustive)}.`, true);
    }
  }

  const text = message.content.find((block) => block.type === "text")?.text;
  let json: unknown;
  try {
    json = JSON.parse(text ?? "");
  } catch {
    throw new LlmError(WRONG_SHAPE, true);
  }
  const parsed = CvDraft.safeParse(json);
  if (!parsed.success) throw new LlmError(WRONG_SHAPE, true);
  return { draft: parsed.data, usage: message.usage };
}

export function createClaudeClient(apiKey: string): MessagesClient {
  return new Anthropic({ apiKey });
}

export function createClaudeLlm(client: MessagesClient, options: ClaudeOptions): Llm {
  return {
    async draft(input) {
      return (await requestDraft(client, options, buildPrompt(input))).draft;
    },
    async revise(input) {
      return (await requestDraft(client, options, buildRevisePrompt(input))).draft;
    },
  };
}
