import { readFile } from "node:fs/promises";
import { checkDraft, countClaims } from "../server/factcheck/factcheck.js";
import { createClaudeClient, requestDraft, type ClaudeOptions } from "../server/llm/claude.js";

const SAMPLES = [
  { file: "test/fixtures/freetext.txt", targetRole: "Customer Success Manager" },
  { file: "test/fixtures/injection.txt", targetRole: "Senior iOS Developer", injected: ["MIT", "PhD", "CTO", "Google"] },
];

const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
if (!apiKey.startsWith("sk-ant-")) {
  console.error("No real ANTHROPIC_API_KEY is set. Export one to run the live smoke test.");
  process.exit(1);
}
const effort = process.env.ANTHROPIC_EFFORT ?? "medium";
if (effort !== "low" && effort !== "medium" && effort !== "high") {
  console.error("ANTHROPIC_EFFORT must be low, medium or high.");
  process.exit(1);
}
const options: ClaudeOptions = { model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5", effort };
const client = createClaudeClient(apiKey);
console.log(`model ${options.model}, effort ${options.effort}`);

let failed = false;
for (const sample of SAMPLES) {
  const source = await readFile(sample.file, "utf8");
  console.log(`\n== ${sample.file} for "${sample.targetRole}"`);
  const started = performance.now();
  try {
    const { draft, usage } = await requestDraft(client, options, { targetRole: sample.targetRole, source });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const checked = checkDraft(draft, { targetRole: sample.targetRole, texts: [source] });
    console.log(`latency ${seconds}s`);
    console.log(
      `usage input ${usage.input_tokens}, output ${usage.output_tokens}, thinking ${usage.output_tokens_details?.thinking_tokens ?? "n/a"}`,
    );
    console.log(`claims returned ${countClaims(draft)}, kept ${countClaims(checked)}`);
    console.log("questions:");
    for (const q of checked.questions) console.log(`  [${q.section}] ${q.text}`);
    console.log("kept CV:");
    console.log(JSON.stringify({ ...checked, questions: undefined }, null, 2));
    for (const term of sample.injected ?? []) {
      const pattern = new RegExp(`\\b${term}\\b`, "i");
      const inDraft = pattern.test(JSON.stringify(draft));
      const inKept = pattern.test(JSON.stringify(checked));
      console.log(`injected "${term}": in model output ${inDraft ? "YES" : "no"}, after fact check ${inKept ? "YES" : "no"}`);
      if (inKept) failed = true;
    }
  } catch (err) {
    failed = true;
    console.log(`failed after ${((performance.now() - started) / 1000).toFixed(1)}s: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failed ? 1 : 0);
