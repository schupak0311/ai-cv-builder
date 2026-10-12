import { readFile } from "node:fs/promises";
import { CvSection } from "../shared/cv.js";
import { checkDraft, countClaims } from "../server/factcheck/factcheck.js";
import { applyRevision } from "../server/jobs/revise.js";
import { createClaudeClient, requestDraft, type ClaudeOptions } from "../server/llm/claude.js";
import { draftToCv, sectionText, type CvDraft, type ReviseInput } from "../server/llm/llm.js";
import { buildPrompt, buildRevisePrompt } from "../server/llm/prompt.js";

const SAMPLES = [
  { file: "test/fixtures/freetext.txt", targetRole: "Customer Success Manager", revise: true },
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

/** A scripted Answer per section, with the facts that must reach that section after the revision. */
const ANSWERS: Record<CvSection, { answer: string; facts: string[] }> = {
  contact: { answer: "My phone number is +351 912 345 678 and I live in Lisbon.", facts: ["+351 912 345 678"] },
  summary: { answer: "I trained 12 new support agents at Sunpath Travel in 2022.", facts: ["12", "2022"] },
  experience: { answer: "At Sunpath Travel I trained 12 new support agents in 2022.", facts: ["12", "2022"] },
  education: { answer: "I studied Modern Languages at the University of Bologna from 2013 to 2014.", facts: ["2013", "2014"] },
  skills: { answer: "I use Salesforce and Jira every day.", facts: ["Salesforce", "Jira"] },
};

async function smokeRevise(targetRole: string, source: string, checked: CvDraft): Promise<boolean> {
  const { content, questions } = draftToCv(checked);
  const [question] = questions;
  if (question === undefined) {
    console.log("revise: the draft has no question to answer");
    return false;
  }
  const { answer, facts } = ANSWERS[question.section];
  console.log(`\n== revise [${question.section}] ${question.text}\nanswer: ${answer}`);
  const input: ReviseInput = {
    targetRole,
    source,
    section: question.section,
    content,
    answered: [{ section: question.section, text: question.text, answer }],
  };
  const started = performance.now();
  try {
    const { draft } = await requestDraft(client, options, buildRevisePrompt(input));
    const revision = applyRevision(input, draft);
    console.log(`latency ${((performance.now() - started) / 1000).toFixed(1)}s`);
    console.log(`claims returned ${revision.claims}, kept ${revision.kept}, kept current section ${revision.keptCurrent ? "YES" : "no"}`);
    const revisedText = sectionText(revision.content, question.section);
    console.log(`revised ${question.section}:\n${revisedText}`);
    const reached = facts.filter((fact) => revisedText.includes(fact));
    console.log(`answer facts in ${question.section}: ${reached.length} of ${facts.length} (${reached.join(", ") || "none"})`);
    const changed = CvSection.options.filter(
      (s) => s !== question.section && JSON.stringify(content[s]) !== JSON.stringify(revision.content[s]),
    );
    console.log(`other sections changed: ${changed.length === 0 ? "none" : changed.join(", ")}`);
    return reached.length === facts.length && changed.length === 0;
  } catch (err) {
    console.log(`revise failed after ${((performance.now() - started) / 1000).toFixed(1)}s: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

let failed = false;
for (const sample of SAMPLES) {
  const source = await readFile(sample.file, "utf8");
  console.log(`\n== ${sample.file} for "${sample.targetRole}"`);
  const started = performance.now();
  try {
    const { draft, usage } = await requestDraft(client, options, buildPrompt({ targetRole: sample.targetRole, source }));
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const checked = checkDraft(draft, { texts: [source] });
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
    if (sample.revise === true && !(await smokeRevise(sample.targetRole, source, checked))) failed = true;
  } catch (err) {
    failed = true;
    console.log(`failed after ${((performance.now() - started) / 1000).toFixed(1)}s: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failed ? 1 : 0);
