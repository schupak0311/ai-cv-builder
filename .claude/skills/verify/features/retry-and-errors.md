# Retry and error states

When a draft or revise job fails, the CV page shows the job's error and a `Try again` button that queues the same job again. The app also explains every way a page can lose its data: a missing or foreign CV shows `CV not found.`, a poll that fails during a job shows `Lost contact with the server. Reconnecting…` above the progress panel until the server answers again, an expired session sends the user to `/login`, and a failed account check shows the error with `Try again`. The CV list refreshes itself every 2 s while any CV is queued or running.

## Sub-features

- `retry-failed` shows a failed job's error and `Try again` on the CV page, and `Failed` on the list.
- `retry-run` queues the failed job again from `Try again`, and the CV appears when it succeeds.
- `retry-dirty` disables a failed revise's `Try again` with `Save or discard your edits before trying again.` while the editor has unsaved edits.
- `retry-transient` requeues a job after a retryable error such as `Could not reach Claude.`, up to 3 attempts. The real API cannot be made to fail that way on demand, so `server/jobs/worker.test.ts` (`a retryable model error is retried, then fails after three attempts`) covers it instead of a browser step.
- `retry-refuse` answers `Nothing to retry.` 409 when the latest job did not fail.
- `error-not-found` shows the heading `CV not found.` and a `Back to your CVs` link for a missing, malformed or foreign CV id.
- `error-poll` shows the `Reconnecting…` alert while a poll fails, keeps the progress panel, and clears the alert on the next good poll.
- `error-session` sends a signed-in page whose session ended to `/login` on its next request.
- `error-account` shows the account check's error with `Try again`, and recovers when it succeeds.
- `list-poll` flips a CV on the list from `Writing` to `Ready` without a reload.

## How to get to it (user POV)

- Open a CV whose job failed, from its `Failed` entry on the list.
- Open `/cvs/<some id>` that is not yours.
- Stay on a CV page or the list while the server or the network drops, or while the session ends in another tab.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold, and the browser is signed in as `$EMAIL`. `$EV/a.jar` is a second session for the same user, from `edit-cv.md`.
- The network injection steps use `browser_run_code_unsafe`, which runs Playwright code against your own page. Keep its routes scoped to your `$B` paths and unroute them before the step ends.

- **Failed job.** With no job running, restart the app on a model that does not exist: `CV_MODEL=claude-does-not-exist "$V" up`. It recreates only the app container and keeps the data, and `"$V" doctor` prints `WARN CV_MODEL=claude-does-not-exist`. Create a CV by API (`create-cv.md`, Create by API) with target role `Retry Probe`. Within a few seconds `"$V" psql "select status, attempts, error from jobs where cv_id='<id>'"` prints `failed|1|The Claude model was not found. Check CV_MODEL.`. The error is final, so the job does not retry. In the browser the list shows `Retry Probe` with `Failed`, and its page shows that error and `role=button[name="Try again"]`, with no editor. Screenshot.
- **Failed revise.** While the bad model is still up, send one Answer on the drafted CV from `questions.md`. The page shows the same error and `Try again` above the Questions panel and the editor, and the list shows that CV as `Failed`. Change `role=textbox[name="Phone"]` without saving: `Try again` is disabled and the note `Save or discard your edits before trying again.` shows. Restore the field and `Try again` is enabled again. Screenshot both.
- **Retry.** Switch back first, `"$V" up`, and check `"$V" doctor` prints `CV_MODEL=claude-sonnet-5-5`. On `Retry Probe`, `browser_click` `role=button[name="Try again"]`. `browser_wait_for` text `Writing your CV`, then text `Download PDF`, repeated until it succeeds. The editor shows the draft. psql now prints the old `failed` row and a new `generate|done|1` row. On the CV with the failed revise, `Try again` shows `Updating your CV`, then the editor with the Answer's fact in its section and the Question under `Answered`. `curl -s -b "$EV/a.jar" -X POST -w ' %{http_code}\n' $B/api/cvs/<id>/retry` prints `{"error":"Nothing to retry."} 409`.
- **Not found.** `browser_navigate` to `$B/cvs/00000000-0000-4000-8000-000000000000`. The `main` holds heading `CV not found.` and link `Back to your CVs`, and no `Delete`. `/cvs/not-a-uuid` and another user's CV id show the same.
- **Account check.** On any signed-in page, run `browser_run_code_unsafe` with `async (page) => { await page.route('**/api/me', r => r.abort()); await page.reload(); await page.getByText('Could not reach the server. Check your connection and try again.').waitFor(); await page.screenshot({ path: '.playwright-mcp/cvb-15-account.png' }); await page.unroute('**/api/me'); await page.getByRole('button', { name: 'Try again' }).click(); return page.url(); }`. The error and `Try again` show, and after the click the same page renders again.
- **Poll failure.** Create a CV by API. Open its page at once, then `browser_run_code_unsafe` with `async (page) => { const p = '**/api/cvs/<id>'; await page.getByText('Writing your CV').waitFor(); await page.route(p, r => r.abort()); const a = page.getByRole('alert').filter({ hasText: 'Lost contact with the server. Reconnecting…' }); await a.waitFor({ timeout: 8000 }); const panel = await page.getByRole('status').filter({ hasText: /Writing your CV|Waiting to start/ }).isVisible(); await page.screenshot({ path: '.playwright-mcp/cvb-16-reconnecting.png' }); await page.unroute(p); await a.waitFor({ state: 'detached', timeout: 8000 }); return { panel }; }`. It returns `{ panel: true }`. A real draft takes about 6 s, so the whole step, from the create to the route, has to run in one go. Create the CV with `fetch` inside the same `browser_run_code_unsafe` and navigate to it there, rather than in separate tool calls.
- **List poll.** Create a CV by API and, while it drafts, open `$B/`. Its entry reads `Writing · <date>`. Without reloading, wait for `Ready` on that entry, as in `browser_run_code_unsafe` `async (page) => { const e = page.getByRole('listitem').filter({ hasText: '<role>' }); await e.waitFor(); const before = await e.innerText(); await e.getByText(/Ready/).waitFor({ timeout: 60000 }); return [before, await e.innerText()]; }`. Screenshot both. The progress steps of `generation-progress.md` end the same way, so one draft can serve both.
- **Expired session.** On `$B/`, in one `browser_run_code_unsafe`, create one more CV with `fetch('/api/cvs', …)` so a job runs, wait for `Waiting to start` or `Writing` on the list, then `await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }))` and `await page.waitForURL('$B/login', { timeout: 5000 })`. The next poll gets 401 and the URL becomes `$B/login` within 2 s. The draft is over in about 6 s, so separate tool calls can miss the running job. Log in again to continue.
- **Restore.** `"$V" up`, so the default model runs again.

## Gotchas

- No Source makes a draft fail. `CV_MODEL=claude-does-not-exist` makes Anthropic answer 404, which the app marks final, and no tokens are spent. It needs outbound network from the container. Without it the job retries 3 times and ends `failed` with `Could not reach Claude.`.
- Switch models only while no job runs. A switch recreates the app, and boot requeues any running job, which then runs on the new model.
- Three different buttons are named `Try again`: the account check, a failed CV load, and a failed job. The context tells them apart.
- `browser_run_code_unsafe` resolves a relative screenshot `path` against the MCP workspace root, so `"$V" grab` finds `.playwright-mcp/<name>` as usual.
- The poll alert shows only while a job exists. With no job the CV page does not poll.
- The expired-session redirect needs a request after the logout. On a page with no running job nothing polls, so the redirect waits for the next navigation.
- A failed revise marks the CV `Failed` on the list even though its content is still there and editable.
