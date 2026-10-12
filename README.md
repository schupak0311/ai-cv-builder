# AI CV Builder

The app drafts an editable CV for a Target role from a PDF or free text, asks Questions about gaps, and exports an A4 PDF with selectable text. A fact check drops every Claim that the user's own text does not back. `CONTEXT.md` defines the capitalised terms.

## Run the app and the tests

You need Docker with Compose.

1. Run `cp .env.example .env` and put your key in `.env` as `ANTHROPIC_API_KEY`.
2. Build and start the app with `docker compose up --build`.
3. Open `http://localhost:8080` and sign up.

To run without a key, set `LLM_MODE=fake` in `.env`. The fake model in `server/llm/fake.ts` quotes the Source's own lines in place of Claude. Otherwise a missing key stops the app at boot with `Set ANTHROPIC_API_KEY in .env`.

Optional settings are `CV_MODEL` (default `claude-opus-5-5`), `CV_EFFORT` (`low`, `medium` or `high`, default `medium`), `FAKE_LLM_DELAY_MS` and `PORT`. They avoid `ANTHROPIC_MODEL` because Claude Code reads it for its own model, and Compose would pass a value such as `opus` into the app.

Run the tests with `docker compose --profile test run --rm --build test`. They need no key and use a separate in-memory Postgres. To run `npm test` against your own Postgres, set `DATABASE_URL` to a database you can lose, because the test setup drops its schema.

`npm run smoke:live` needs `ANTHROPIC_API_KEY` exported in your shell. On the real API it drafts `test/fixtures/freetext.txt`, answers one of its Questions, and drafts `test/fixtures/injection.txt`, which plants an instruction to add a PhD from MIT. Set `CV_MODEL=claude-sonnet-5-5` for a cheaper model.

## Architecture and the decisions behind it

Compose runs Postgres 17 and one Node 22 process, which serves the Fastify REST API and the React app on port 8080 and runs the job worker. The server and the browser share zod schemas in `shared/`.

**Jobs are rows in Postgres.** A table the API already reads replaces a queue service, and a reload loses nothing. A transient failure gets up to 3 attempts, and a failed job shows a **Try again** button. A restart requeues an interrupted job unless it has used all 3 attempts. The CV page polls every 2 seconds during a job, and migration `002` limits each CV to one active job.

**Server-side sessions.** `crypto.scrypt` hashes passwords, and the database keeps only a SHA-256 of each session token. Every CV query filters by `owner_id`, so another user's CV is a 404.

**One version number per CV.** A stale save, or one during a job, gets a 409.

**Structured output, checked before parsing.** The client calls `messages.create`, not `messages.parse`, so it can read `stop_reason` first. A refusal fails the job, a cut-off reply is retried, and only then is the JSON parsed against the zod schema.

**Answers revise one section.** An Answer queues a `revise` job for its Question's section and is stored only if that job succeeds, so a failed revise leaves the Question open.

**Untrusted input.** Pasted text is 50 to 20,000 characters. An upload must start with `%PDF-`, be at most 5 MB and 10 pages, and yield at least 100 characters of text, so a scanned PDF is rejected. React and the PDF renderer write text only.

**`pdfmake` for export.** In a prototype, `@react-pdf/renderer` lost characters of a long URL from the text layer, and `pdfmake` did not.

## How the AI is kept from inventing facts

The prompt asks the model not to invent facts. The fact check removes what it invents anyway.

`server/llm/prompt.ts` puts the Source in `<source_document>` tags, escapes any copy of those tags inside it, and calls the block data, never instructions. It asks for Evidence, passages copied from the Source, on every summary sentence, bullet and experience or education item. The app keeps at most 8 Questions.

`server/factcheck/factcheck.ts` checks every draft and revision against a corpus of the Source, plus, for a revision, every Answer and the section text the model was shown. The Target role is not in the corpus. The rules are these:

1. Both sides are normalised with NFKC, lower case, one form of each quote and dash, hyphens between letters ignored, and collapsed whitespace.
2. Every Evidence quote must be at least two words long and occur in the corpus at word boundaries, so "15" inside "2015" does not count.
3. Every number in a Claim, including spelled-out ones such as "four" or "twenty-five", must appear in that Claim's own Evidence.
4. Every term with an uppercase letter, such as `Meta` or `iOS`, must appear in the Claim's own Evidence. Only a sentence's plain title-case first word, such as "Led", is exempt, and a colon does not start a sentence.
5. Contact values and skills must appear in the corpus as whole phrases.
6. A failing sentence, bullet, contact value or skill is dropped, a failing header field becomes null, and an empty item is dropped. The worker logs the count.

So every AI-written sentence, bullet and experience or education field in a stored CV rests on a quote of at least two words from the user's own text. That quote holds its numbers and non-exempt uppercase terms. Hand edits are not checked.

The check catches invented names and numbers, not invented prose. These limits remain:

- Lowercase embellishment and inference pass. In a live run, "english and portuguese pretty well" became "fluent in Italian, English and Portuguese", and a bullet called the user "her" with no pronoun in the Source.
- A sentence's title-case first word is unchecked, because checking it would also drop rephrased verbs such as "Led".
- One long quote that spans two adjacent jobs pools their vocabulary, so a bullet under one job can borrow the other's names.
- A real fact that the check misreads is dropped without notice.

Single live runs on 2026-10-12 at effort `medium` show the check on real model output.

- **Smoke script.** On `claude-sonnet-5-5` the free-text draft took 8.5 s, with 2,302 input and 1,236 output tokens, 22 of 26 Claims kept and 7 Questions. On the default `claude-opus-5-5` it took 23.8 s, with 2,302 input and 2,573 output tokens, 21 of 26 Claims kept and 8 Questions. One Answer added both its facts to the experience section and changed no other section, in 4.2 s on `claude-sonnet-5-5` and 10.9 s on the default model. Neither model's output contained the planted MIT, PhD, CTO or Google.
- **Full flow through Compose on `claude-sonnet-5-5`.** A draft from `test/fixtures/one-column-en.pdf` took 11 s, and the check kept all 41 Claims, each matching the PDF. The Questions covered the missing end date at Brightwater Insurance and each vague bullet. The date Answer set that end date to "March 2021" in about 6 s, and the downloaded PDF was one A4 page.

## What was simplified, and what would change with more time

These parts are simplified:

- Sources and CVs are English only.
- A failing Claim is dropped, not held for the user to confirm.
- One in-process worker runs jobs, with no lease or heartbeat.
- The browser polls instead of keeping a stream open.
- PDF parsing runs on the API's event loop with no time limit, and there is no OCR.
- The SDK's own retries stack with the worker's.
- Only the server has tests, and there is no CI. The verify skill checks browser flows when an agent runs it.
- Fact-check tests use hand-written drafts and the fake model.

With more time, these would come first:

1. Run `npm run smoke:live` on real CVs and tune the rules on what the check wrongly drops and misses.
2. Turn a failed Claim into a Question instead of dropping it.
3. Build the revise flow as one unit. Parallel units assembled it, and the review found it the least integrated part.
4. Move PDF parsing into the worker with a time limit, and keep one layer of retries.
5. Add browser tests for the main flow.

## How AI tools were used

Claude Code built the whole repository. A coordinating session asked the repository owner a few scoping questions, planned the work, and gave each unit to an agent in its own git worktree. It reviewed every diff, re-ran typecheck, lint and the full test suite, and checked each unit in the running app before merging it to `main`. Two read-only Opus reviewers at extra-high effort then reviewed the codebase adversarially, and one fresh agent got the findings to act on or consider.

The process caught these mistakes:

- One agent's tests ran against another worktree's database, which the test setup wipes. That became the `DATABASE_URL` rule in `.agents/lessons.md`.
- `docker-compose.yml` never passed the model and effort settings to the container. Commit `c212264` fixed it.
- The review found the fact-check holes that the rules above now close: raw substring quotes, the Target role allowance, names that start lowercase and spelled-out numbers. It also found the `ANTHROPIC_MODEL` clash with Claude Code.

`CONTEXT.md`, `.agents/lessons.md` and `.claude/skills/verify/` are the AI artefacts the repository commits.
