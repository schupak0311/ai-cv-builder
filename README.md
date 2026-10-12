# AI CV Builder

A signed-in user uploads a CV as a PDF or describes their background in free text, and names a Target role. The app drafts a CV for that role, asks Questions about anything missing or vague, and lets the user edit every field and download an A4 PDF with selectable text. The AI may rephrase and restructure, but a fact check drops every Claim that the user's own text does not back. `CONTEXT.md` defines the terms used here.

## Run the app and the tests

You need Docker with Compose.

1. Run `cp .env.example .env` and put your key in `.env` as `ANTHROPIC_API_KEY`.
2. Build and start the app with `docker compose up --build`.
3. Open `http://localhost:8080` and sign up.

To run without a key, set `LLM_MODE=fake` in `.env`. The fake model in `server/llm/fake.ts` then quotes the Source's own lines, and everything except the Claude call is the real code. In the default real mode with no key, the app exits at boot with `Set ANTHROPIC_API_KEY in .env`. The optional settings are `CV_MODEL` (default `claude-opus-5-5`), `CV_EFFORT` (`low`, `medium` or `high`, default `medium`), `FAKE_LLM_DELAY_MS` and `PORT`. They avoid the name `ANTHROPIC_MODEL` because Claude Code reads it for its own model, and Compose would pass a value such as `opus` into the app.

Run the tests with `docker compose --profile test run --rm --build test`. They need no key, because they use the fake model, scripted models and a stubbed Claude client against a separate Postgres that keeps its data in memory. To run `npm test` against your own Postgres, set `DATABASE_URL` to a database you can lose, because the test setup drops and recreates its schema.

`npm run smoke:live` calls the real API and needs `ANTHROPIC_API_KEY` exported in your shell. It drafts `test/fixtures/freetext.txt`, a casual free-text Source, and `test/fixtures/injection.txt`, which plants an instruction to add a PhD from MIT. It prints the latency, the token usage, how many Claims the fact check kept and whether a planted term survived. Then it answers one Question and prints whether the Answer reached its section. Set `CV_MODEL=claude-sonnet-5-5` to test on a cheaper model.

## Architecture and the decisions behind it

Compose runs two containers. `db` is Postgres 17 with no published port. `app` is one Node 22 process that applies the migrations at boot, serves the Fastify REST API and the built React app on port 8080, and runs the job worker. The server and the browser share the zod schemas in `shared/` for the stored CV and the API.

**Jobs are rows in Postgres.** The worker claims the oldest queued job with `FOR UPDATE SKIP LOCKED`, and on success writes the content, the Questions and `done` in one transaction. A transient failure, such as a rate limit or a malformed reply, gets up to 3 attempts. A failed job shows a readable message and a **Try again** button. The work in progress is in the database, so a reload loses nothing, and the CV page polls every 2 seconds while a job is active. Migration `002` adds a partial unique index for one active job per CV. At boot the app requeues every `running` job and fails any job that has used all 3 attempts. That is safe because only one process runs jobs. A table the API already reads replaces a queue service, at the cost of a single worker.

**Server-side sessions.** Passwords are hashed with `crypto.scrypt`. The `sid` cookie holds a random token, `HttpOnly` and `SameSite=Lax`, and the database stores only its SHA-256. Every query that reaches a CV filters by `owner_id`, so another user's CV is a 404 on every route.

**One version number per CV.** The editor saves with the version it loaded. A stale version, or a save while a job is active, gets a 409 and changes nothing. **Answer** is disabled while the editor has unsaved edits, because the editor closes while the revise job runs. The edit limits live in the shared `Cv` schema, and model output over them is dropped, so a stored draft can always be saved again.

**Structured output, checked before parsing.** The Claude client calls `claude-opus-5-5` at effort `medium` through `@anthropic-ai/sdk`, with no tools and with `output_config.format` built by `zodOutputFormat`. It uses `messages.create` rather than `messages.parse`, because `parse` throws on a cut-off reply before the caller can see `stop_reason`. So the client checks `stop_reason` first. A refusal fails the job with its own message, and a cut-off reply is retried. Only then does it parse the JSON against the zod schema.

**Answers revise one section.** An Answer queues a `revise` job, and the worker swaps only the Question's section into the CV. The Answer is stored only when its revise job succeeds, so a failed revise leaves its Question open.

**Untrusted input.** Pasted text is 50 to 20,000 characters. An upload must start with `%PDF-`, be at most 5 MB and 10 pages, and yield at least 100 characters of text, so a scanned PDF is rejected. The app keeps the extracted text, never the PDF. NUL characters are stripped at the input boundary. React and the PDF renderer write text only.

**`pdfmake` for export.** In a throwaway prototype, `@react-pdf/renderer` lost characters of a long URL from the PDF's text layer, and `pdfmake` did not.

## How the AI is kept from inventing facts

The prompt asks the model not to invent facts. The fact check removes what it invents anyway.

`server/llm/prompt.ts` puts the Source inside `<source_document>` tags and escapes any copy of those tags inside it, so the block has exactly one end. The system prompt says the block is data, never instructions. It forbids new facts and asks for Evidence, passages copied from the Source, on every summary sentence, bullet and experience or education item. When something is missing or vague, the model asks a Question about one section. Questions are cut to 8.

`server/factcheck/factcheck.ts` is a pure function that checks every draft and revision before anything is stored. Its rules are these:

1. The check normalises both sides with NFKC, lower case, one form of each quote and dash, hyphens between letters ignored, and collapsed whitespace.
2. Every Evidence quote must be at least two words long and occur in the corpus at word boundaries. "15" inside "2015" does not count.
3. Every number in a Claim must appear in that Claim's own Evidence. Spelled-out numbers such as "four" or "twenty-five" are compared too.
4. Every term with an uppercase letter, such as `Meta` or `iOS`, must appear in the Claim's own Evidence. In a sentence only a plain title-case first word, such as "Led", is exempt, and a colon does not start a sentence. In a header field, such as an employer or a date, no word is exempt.
5. Contact values and skills must appear in the corpus as whole phrases.
6. A failing sentence, bullet, contact value or skill is dropped. A failing header field becomes null, and an item left with nothing is dropped. The user is not told, and the worker logs the count.

The corpus is the Source. For a revision it also holds every Answer and the exact current-section text the model was shown. The Target role gets no allowance, so a summary that gives the user the role's title needs Evidence that contains it.

So every AI-written sentence, bullet and experience or education field in a stored CV is backed by a quote of at least two words from the user's own text. Every number in it, and every term with an uppercase letter other than a plain title-case first word, appears in that quote. Every AI-written contact value and skill appears in the user's text. Hand edits are not checked.

The check is mechanical. It catches invented names and numbers, not invented prose. These limits remain:

- Lowercase embellishment passes. In a live run, "english and portuguese pretty well" became "fluent in Italian, English and Portuguese", because the quote is real and "fluent" is neither a number nor a name.
- A title-case word that starts a sentence is unchecked. Checking it would also drop rephrased verbs such as "Led". That loses too much.
- One long quote that spans two adjacent jobs pools their vocabulary, so a bullet under one job can borrow the other's names.
- A real fact that the check misreads is dropped without notice.

Two live runs on 2026-10-12 show the check on real model output. Both used `CV_MODEL=claude-sonnet-5-5` at effort `medium` to keep testing cheap. They are single runs, not a benchmark, and the default model, `claude-opus-5-5`, was not measured.

- **Smoke script.** The free-text draft took 8.5 s with 2,302 input and 1,236 output tokens. The fact check kept 22 of 26 Claims, and the model asked 7 Questions. Answering one Question added both of its facts to the experience section in 4.2 s and changed no other section. The injection sample's planted MIT, PhD, CTO and Google never appeared in the model's output.
- **Full flow through Compose.** Uploading `test/fixtures/one-column-en.pdf` produced a draft in 11 s. Every kept fact matched the PDF, and the fact check kept all 41 Claims. The Questions asked about the missing end date at Brightwater Insurance and about each vague bullet. Answering the date question set that end date to "March 2021" in about 6 s. The downloaded PDF was one A4 page.

## What was simplified, and what would change with more time

These parts are simplified:

- Sources and CVs are English only.
- A Claim that fails the check is dropped, not held for the user to confirm.
- One in-process worker runs jobs, with no lease or heartbeat.
- The browser polls instead of keeping a stream open.
- PDF parsing runs on the API's event loop with no time limit, and there is no OCR.
- The SDK's own retries stack with the worker's.
- The tests cover the server only. The verify skill checks the browser flows when an agent runs it, and there is no CI.
- The fact check is tested on hand-written drafts and the fake model. Real model output was checked only in the few live runs above, not on a set of real CVs.

With more time, these would come first:

1. Run `npm run smoke:live` on a set of real CVs, count what the check wrongly drops and what it misses, and tune the rules on those counts.
2. Turn a failed Claim into a Question instead of dropping it.
3. Build the revise flow as one unit. The review found that the revise job lifecycle was the least integrated part, because parallel units assembled it.
4. Move PDF parsing into the worker with a time limit, and keep one layer of retries.
5. Add browser tests for the main flow.

## How AI tools were used

Claude Code built the whole repository. One coordinating session planned the work and asked the repository owner a short round of scoping questions, which settled that each CV owns its Source, that everything is in English, and that a failing Claim is dropped. It wrote a brief for each unit and gave each unit to a separate agent in its own git worktree, some in parallel on disjoint files. The coordinator reviewed every diff, re-ran typecheck, lint and the full test suite itself, and checked each unit in the running app before a fast-forward merge to `main`. It wired the Questions panel into the CV page by hand.

The process had three other parts:

- A throwaway prototype compared the two PDF renderers on the same sample CVs and picked `pdfmake`.
- `.claude/skills/verify/` was generated once the first unit booted, and updated as features landed. It drives the app with the fake model in a real browser and with curl, and saves screenshots, API responses and job rows as evidence.
- Two independent read-only reviewers, Opus at extra-high effort, reviewed the whole codebase adversarially. Their findings were sorted into act on, consider, noted and dismissed, and a fresh agent got every act-on and consider finding in one brief.

The process caught these mistakes:

- One agent's test run pointed at another worktree's test database, which the test setup wipes. That became the `DATABASE_URL` rule in `.agents/lessons.md`.
- `docker-compose.yml` never passed the model and effort settings to the container. Commit `c212264` fixed it.
- The review found the fact-check holes that the rules above now close: raw substring quotes, the Target role allowance, names that start lowercase and spelled-out numbers. It also found the `ANTHROPIC_MODEL` clash with Claude Code.

The repository commits three AI artefacts. `CONTEXT.md` is the domain glossary. `.agents/lessons.md` holds the corrections from this build that apply to any agent in the repository. `.claude/skills/verify/` is the verification skill.
