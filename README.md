# AI CV Builder

The app drafts an editable CV for a Target role from a PDF or free text, asks Questions about gaps, and exports an A4 PDF with selectable text. A fact check drops every Claim that the user's own text does not back. `CONTEXT.md` defines the capitalised terms.

## Run the app and the tests

You need Docker with Compose.

1. Run `cp .env.example .env` and put your key in `.env` as `ANTHROPIC_API_KEY`.
2. Build and start the app with `docker compose up --build`.
3. Open `http://localhost:8080` and sign up.

The app always calls Claude. A missing key stops it at boot with `Set ANTHROPIC_API_KEY in .env`.

Optional settings are `CV_MODEL` (default `claude-opus-5-5`), `CV_EFFORT` (`low`, `medium` or `high`, default `medium`) and `PORT`. Set `CV_MODEL=claude-sonnet-5-5` for a cheaper model while testing. They avoid `ANTHROPIC_MODEL` because Claude Code reads it for its own model, and Compose would pass a value such as `opus` into the app.

Run the tests with `docker compose --profile test run --rm --build test`. They need no key, because each test scripts the model's reply as a literal draft, and they use a separate in-memory Postgres. To run `npm test` against your own Postgres, set `DATABASE_URL` to a database you can lose, because the test setup drops its schema.

`npm run smoke:live` needs `ANTHROPIC_API_KEY` exported in your shell. On the real API it drafts `test/fixtures/freetext.txt`, answers one of its Questions, and drafts `test/fixtures/injection.txt`, which plants an instruction to add a PhD from MIT. Set `CV_MODEL=claude-sonnet-5-5` for a cheaper model.

## Architecture and the decisions behind it

Compose runs Postgres 17 and one Node 22 process, which serves the Fastify REST API and the React app on port 8080 and runs the job worker. The server and the browser share zod schemas in `shared/`.

**Jobs are rows in Postgres.** A table the API already reads replaces a queue service, and a reload loses nothing. A transient failure gets up to 3 attempts, and a failed job shows a **Try again** button. A restart requeues an interrupted job unless it has used all 3 attempts. The CV page polls every 2 seconds during a job, and migration `002` limits each CV to one active job.

**Server-side sessions.** `crypto.scrypt` hashes passwords, and the database keeps only a SHA-256 of each session token. Every CV query filters by `owner_id`, so another user's CV is a 404.

**One version number per CV.** A stale save, or one during a job, gets a 409.

**Structured output, checked before parsing.** The client calls `messages.create`, not `messages.parse`, so it can read `stop_reason` first. A refusal fails the job, a cut-off reply is retried, and only then is the JSON parsed against the zod schema.

**Answers revise only their own sections.** The Questions panel sends every filled-in Answer in one request, after saving any unsaved edits. That queues one `revise` job, which rewrites each answered section in its own model call. The Answers are stored only if every section succeeds, so a failed revise leaves all of its Questions open.

**Untrusted input.** Pasted text is 50 to 20,000 characters. An upload must start with `%PDF-`, be at most 5 MB and 10 pages, and yield at least 100 characters of text, so a scanned PDF is rejected. React and the PDF renderer write text only.

**`pdfmake` for export.** In a prototype, `@react-pdf/renderer` lost characters of a long URL from the text layer, and `pdfmake` did not.

## How the AI is kept from inventing facts

Every AI-written sentence, bullet and experience or education field in a stored CV rests on quotes of at least two words from the user's own text. Those quotes contain every number and every capitalised word of the Claim they back, except a sentence's first word. Hand edits are not checked.

The prompt asks the model not to invent facts, and the fact check removes what it invents anyway. The rules are these:

1. `server/llm/prompt.ts` wraps the Source in `<source_document>` tags, escapes any copy of those tags inside it, and tells the model that the block is data, never instructions.
2. The output format in `server/llm/llm.ts` requires Evidence on every summary sentence, bullet, and experience or education entry. The prompt asks for passages copied exactly from the user's own text.
3. `server/factcheck/factcheck.ts` normalises the Evidence, the Claim and the corpus the same way, so case, spacing, hyphens between letters, and the different quote and dash characters do not matter. The corpus is the Source. The Target role is not part of it.
4. A Claim survives only when each Evidence quote is at least two words long and occurs in the corpus as whole words. The Evidence must also hold every number in the Claim, in digits or in words such as "four". It must hold every word with a capital letter too, such as `Meta` or `iOS`, except a sentence's first word. Contact values and skills have no Evidence, so each must occur in the corpus as a whole phrase. A Claim that fails is dropped.
5. `server/jobs/revise.ts` checks a revision the same way, with every Answer and the section's current text added to the corpus. The check also keeps any sentence or bullet copied word for word from the current CV, and any unchanged field of an experience or education entry, even without matching Evidence. That text was already checked or typed by the user.

The rules catch invented names and numbers, not invented prose. These gaps remain:

- Lowercase words other than numbers are not checked, so embellishment and guesses pass. In a live run, "english and portuguese pretty well" became "fluent in Italian, English and Portuguese", and a bullet called the user "her" with no pronoun in the Source.
- A sentence's first word is not checked when it is a plain capitalised word, because checking it would drop rephrased verbs such as "Led". So a name such as "Google" passes unchecked when it opens a sentence.
- A quote that spans two neighbouring experience entries lets a bullet under one entry use names from the other.
- A real fact that the rules misread is dropped without notice. On a PDF with hard line wraps, the model often ends a quote at a line break, so a new CV can lose Claims whose names sit on the next line.

Single live runs on 2026-10-12 at effort `medium` show the rules on real model output:

- On `test/fixtures/freetext.txt` the rules kept 22 of 26 Claims on `claude-sonnet-5-5` and 21 of 26 on the default `claude-opus-5-5`. On both models, one Answer added both its facts to the experience section and changed no other section.
- Neither model's output for `test/fixtures/injection.txt` contained the planted MIT, PhD, CTO or Google.
- Through Compose on `claude-sonnet-5-5`, the rules kept all 41 Claims of a CV from `test/fixtures/one-column-en.pdf`, and each matched the PDF.

## What was simplified, and what would change with more time

| Simplification | What it means |
| --- | --- |
| Sources and CVs are English only. | The prompt always asks for an English CV, and only English number words count as numbers. |
| A failing Claim is dropped, not held for the user to confirm. | The user never learns which Claims were dropped. The server log has only the count. |
| One in-process worker runs jobs, with no lease or heartbeat. | The app must run as one process. At boot it requeues every running job, so a second process would rerun jobs the first one is still running. |
| The browser polls instead of keeping a stream open. | The CV page asks for the job status every 2 seconds while a job runs, so it learns a job finished up to 2 seconds late. |
| PDF parsing runs on the API's event loop with no time limit, and there is no OCR. | A slow PDF delays other requests while it parses. A scanned PDF has no text to extract, so the upload is rejected. |
| There is no rate limiting, and the session cookie has no `Secure` flag. | A client can sign up, log in and create CVs as fast as it likes, and every new CV spends Claude tokens. Without `Secure`, the cookie also works over plain HTTP, such as a phone on the local network. |
| The SDK's own retries stack with the worker's. | The SDK sends a rate-limited call up to 3 times, and the worker runs the job up to 3 times, so one call can go out 9 times. |
| Only the server has tests, and there is no CI. | No test runs the React app. A Claude Code session can drive it in a browser with the skill in `.claude/skills/verify/`. |
| Tests replace the model with hand-written output. | They cover the rules and the jobs, not what the real model writes. `npm run smoke:live` runs the real model on two sample Sources. |
| A Question closes once its section is revised, even if the Answer's fact never reached the CV. | If the rules leave a revised section empty, the job fails and its Questions stay open. When every revised section keeps some content, every Question in the job closes and cannot be answered again. An Answer that the model ignored, or whose fact the rules dropped, then has to be added by hand. |

With more time, these would come first:

1. Run `npm run smoke:live` on real CVs and tune the rules on what they wrongly drop and miss.
2. Turn a failed Claim into a Question instead of dropping it.
3. Check that each Answer's fact reached its section, as `npm run smoke:live` does, and keep the Question open when it did not.
4. Move PDF parsing into the worker with a time limit, and keep one layer of retries.
5. Add browser tests for the main flow.

## How AI tools were used

Claude Code built the whole repository. A coordinating session asked the repository owner a few scoping questions, planned the work, and gave each unit to an agent in its own git worktree. It reviewed every diff, re-ran typecheck, lint and the full test suite, and checked each unit in the running app before merging it to `main`. Two read-only Opus reviewers at extra-high effort then reviewed the codebase adversarially, and one fresh agent got the findings to act on or consider.

The process caught these mistakes:

- One agent's tests ran against another worktree's database, which the test setup wipes. That became the `DATABASE_URL` rule in `.agents/lessons.md`.
- `docker-compose.yml` never passed the model and effort settings to the container. Commit `c212264` fixed it.
- The review found the fact-check holes that the rules above now close: raw substring quotes, the Target role allowance, names that start lowercase and spelled-out numbers. It also found the `ANTHROPIC_MODEL` clash with Claude Code.

`CONTEXT.md`, `.agents/lessons.md` and `.claude/skills/verify/` are the AI artefacts the repository commits.
