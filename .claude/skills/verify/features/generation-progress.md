# Generation progress

While a CV is being drafted, its page shows a progress panel with the job's state and a seconds counter, and polls until the CV appears. The user can reload or leave and come back, and a server restart in the middle of a draft does not lose the job: it runs again after boot and the CV still appears.

## Sub-features

- `progress-panel` shows `Waiting to start`, then `Writing your CV`, with a counter that keeps counting.
- `progress-poll` replaces the panel with the CV without a reload.
- `progress-reload` shows the same panel and counter after a browser reload mid-job.
- `progress-leave` shows the CV as `Writing` on the list while the job runs and `Ready` after.
- `progress-restart` recovers a job interrupted by `docker compose restart app` and finishes it.
- `progress-failed` shows the job's error instead of the CV when drafting fails.

## How to get to it (user POV)

- Submit `Write my CV` on `/cvs/new`. The CV page opens with the panel.
- Reopen a CV that is still drafting from the list at `/`.
- Reload `/cvs/<id>` while the panel shows.

## Driving it with Playwright MCP and curl

Preconditions:

- The instance runs with a long draft. Run `FAKE_LLM_DELAY_MS=20000 "$V" up`, which recreates only the app container if it was up with another delay. `"$V" doctor` prints `FAKE_LLM_DELAY_MS=20000`.
- The browser is signed in as a fresh user with no CVs.

- **Start a draft.** Create a CV as in `create-cv.md`, Paste mode, Fill form and Submit, with target role `Staff Engineer`. Record `<id>`.
- **Panel.** `browser_wait_for` text `Writing your CV`. The `status` region reads `Writing your CV · <n> s` and the note `This can take a minute. You can leave this page and come back later.`. Screenshot.
- **Reload.** `browser_navigate` to `$B/cvs/<id>`. The panel shows again and the counter has not reset to 0, because it counts from the job's creation time. Screenshot.
- **Leave.** `browser_click` `role=link[name="AI CV Builder"]`. The list shows `Staff Engineer` with `Writing · <today>`. Choose `Staff Engineer` to return.
- **Restart mid-job.** While the panel reads `Writing your CV`, run `"$V" psql "select status, attempts from jobs where cv_id='<id>'"`, which must print `running|1`. Then `"$V" restart`. Then the same query prints `running|2` or `queued|1`, and `"$V" logs --tail 40` has a line with `"requeued":1`. Save all three outputs into `$EV`.
- **Recovery.** Stay on the page without reloading. `browser_wait_for` text `Skills`, repeated until it succeeds, since each call gives up after 5 s. The draft reruns from the start, so allow about 25 s. The panel is gone and the CV shows. `"$V" psql` now prints `done|2`. Screenshot and `browser_snapshot`.
- **Failed state.** Unreachable in fake mode today. The fake model never fails, and `LLM_MODE=real` without the Claude client fails every job with `The Claude model is not connected yet. Run with LLM_MODE=fake.`. Report `progress-failed` as skipped with that reason.
- **Restore.** Run `FAKE_LLM_DELAY_MS=5000 "$V" up` before driving other features.

## Gotchas

- With the default 5 s delay the job finishes before a restart lands, because each agent tool call takes seconds. If the first query already prints `done|1`, the restart was not exercised. Report that, raise the delay, and rerun. Do not report it passed.
- `"$V" restart` keeps the container's environment. A bare `docker compose up` would recreate it in `real` mode.
- The page keeps polling through the restart. A poll that fails while the server is down can show the error text in place of the panel until the next poll succeeds 2 s later. That is expected, not a failure, unless it stays.
- `attempts` counts claims, so a restart that lands while the job is `queued` leaves `attempts` at 1 and proves nothing about recovery. Restart only after `running|1`.
- The counter is derived from the browser clock and the job's `createdAt`. A skewed Docker VM clock shows an odd starting number. The order of states is the proof, not the number.
