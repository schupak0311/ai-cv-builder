# Retry and error states

When a draft or revise job fails, the CV page shows the job's error and a `Try again` button that queues the same job again. The app also explains every way a page can lose its data: a missing or foreign CV shows `CV not found.`, a poll that fails during a job shows `Lost contact with the server. Reconnecting…` above the progress panel until the server answers again, an expired session sends the user to `/login`, and a failed account check shows the error with `Try again`. The CV list refreshes itself every 2 s while any CV is queued or running.

## Sub-features

- `retry-failed` shows a failed job's error and `Try again` on the CV page, and `Failed` on the list.
- `retry-run` queues the failed job again from `Try again`, and the CV appears when it succeeds.
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

- **Failed job.** Switch the app to real mode with the dummy key: `LLM_MODE=real "$V" up`. It recreates only the app container and keeps the data, and `"$V" doctor` prints `WARN LLM_MODE=real`. Create a CV by API (`create-cv.md`, Create by API) with target role `Retry Probe`. Within a few seconds `"$V" psql "select status, attempts, error from jobs where cv_id='<id>'"` prints `failed|1|The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.`. In the browser the list shows `Retry Probe` with `Failed`, and its page shows that error and `role=button[name="Try again"]`, with no editor. Screenshot.
- **Retry.** Switch back first, `FAKE_LLM_DELAY_MS=5000 "$V" up`, and check `"$V" doctor` prints `LLM_MODE=fake`. `browser_click` `role=button[name="Try again"]`. `browser_wait_for` text `Writing your CV`, then text `Download PDF`, repeated until it succeeds. The editor shows the draft. psql now prints the old `failed` row and a new `generate|done|1` row. `curl -s -b "$EV/a.jar" -X POST -w ' %{http_code}\n' $B/api/cvs/<id>/retry` prints `{"error":"Nothing to retry."} 409`.
- **Not found.** `browser_navigate` to `$B/cvs/00000000-0000-4000-8000-000000000000`. The `main` holds heading `CV not found.` and link `Back to your CVs`, and no `Delete`. `/cvs/not-a-uuid` and another user's CV id show the same.
- **Account check.** On any signed-in page, run `browser_run_code_unsafe` with `async (page) => { await page.route('**/api/me', r => r.abort()); await page.reload(); await page.getByText('Could not reach the server. Check your connection and try again.').waitFor(); await page.screenshot({ path: '.playwright-mcp/cvb-15-account.png' }); await page.unroute('**/api/me'); await page.getByRole('button', { name: 'Try again' }).click(); return page.url(); }`. The error and `Try again` show, and after the click the same page renders again.
- **Poll failure.** Run `FAKE_LLM_DELAY_MS=30000 "$V" up` and create a CV by API. Open its page, then `browser_run_code_unsafe` with `async (page) => { const p = '**/api/cvs/<id>'; await page.getByText('Writing your CV').waitFor(); await page.route(p, r => r.abort()); const a = page.getByRole('alert').filter({ hasText: 'Lost contact with the server. Reconnecting…' }); await a.waitFor({ timeout: 8000 }); const panel = await page.getByRole('status').filter({ hasText: 'Writing your CV' }).isVisible(); await page.screenshot({ path: '.playwright-mcp/cvb-16-reconnecting.png' }); await page.unroute(p); await a.waitFor({ state: 'detached', timeout: 8000 }); return { panel }; }`. It returns `{ panel: true }`.
- **List poll.** With that CV still drafting, `browser_click` `role=link[name="AI CV Builder"]`. Its entry reads `Writing · <date>`. Without reloading, `browser_wait_for` text `Ready` on that entry, repeated until it succeeds. Screenshot both.
- **Expired session.** Create one more CV by API so a job runs, and stay on `$B/`. `browser_evaluate` `() => fetch('/api/auth/logout', { method: 'POST' })`. Within 2 s the next poll gets 401 and the URL becomes `$B/login`. Log in again to continue.
- **Restore.** `FAKE_LLM_DELAY_MS=5000 "$V" up`.

## Gotchas

- The fake model never fails, and no Source makes it fail. Real mode with `ANTHROPIC_API_KEY=dummy` is the free route to a failed job, because Anthropic rejects the key on the first call and the app marks that error final. It needs outbound network from the container. Without it the job retries 3 times and ends `failed` with `Could not reach Claude. Trying again.`.
- Never set a real key for this. Real mode with a real key calls Claude for every job and costs money.
- A mode switch restarts the app, and boot requeues any job that was running. A job requeued in real mode fails too, with `attempts` 2.
- Three different buttons are named `Try again`: the account check, a failed CV load, and a failed job. The context tells them apart.
- `browser_run_code_unsafe` resolves a relative screenshot `path` against the MCP workspace root, so `"$V" grab` finds `.playwright-mcp/<name>` as usual.
- The poll alert shows only while a job exists. With no job the CV page does not poll.
- The expired-session redirect needs a request after the logout. On a page with no running job nothing polls, so the redirect waits for the next navigation.
