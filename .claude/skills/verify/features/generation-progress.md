# Generation progress

While a CV is being drafted, its page shows a progress panel with the job's state and a seconds counter, and polls until the CV appears. The user can reload or leave and come back, and a server restart in the middle of a draft does not lose the job: it runs again after boot and the CV still appears.

## Sub-features

- `progress-panel` shows `Waiting to start`, then `Writing your CV` for a draft or `Updating your CV` for a revise (`questions.md`), with a counter that keeps counting.
- `progress-poll` replaces the panel with the editor without a reload.
- `progress-reload` shows the same panel and counter after a browser reload mid-job.
- `progress-leave` shows the CV as `Writing` on the list while the job runs, and the list flips it to `Ready` by itself when the job ends.
- `progress-restart` recovers a job interrupted by `docker compose restart app` and finishes it.
- `progress-failed` shows the job's error and `Try again` instead of the editor when drafting fails. Driven in `retry-and-errors.md`.

## How to get to it (user POV)

- Submit `Write my CV` on `/cvs/new`. The CV page opens with the panel.
- Reopen a CV that is still drafting from the list at `/`.
- Reload `/cvs/<id>` while the panel shows.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold. A real draft takes about 6 s on Sonnet, so each step below has to start while the job still runs. Run the browser part of a step in one `browser_run_code_unsafe` that creates the CV with `fetch('/api/cvs', …)` and navigates to it, rather than in separate tool calls.
- The browser is signed in.

- **Start a draft.** Create a CV with target role `Staff Engineer`, either through the form as in `create-cv.md` (Paste mode, Fill form and Submit) or with `fetch` in the page, and open `$B/cvs/<id>`. Record `<id>`. Right after the create, `fetch('/api/cvs/<id>/pdf')` answers `409` `{"error":"This CV has no content yet."}` (`pdf-export.md`, Refusals).
- **Panel.** `browser_wait_for` text `Writing your CV`. The `status` region reads `Writing your CV · <n> s` and the note `This can take a minute. You can leave this page and come back later.`. Screenshot.
- **Reload.** `browser_navigate` to `$B/cvs/<id>`. The panel shows again and the counter has not reset to 0, because it counts from the job's creation time. Screenshot.
- **Leave.** `browser_click` `role=link[name="AI CV Builder"]`. The list shows `Staff Engineer` with `Writing · <today>`. Without reloading, the entry turns to `Ready · <today>` when the draft lands (`retry-and-errors.md`, List poll).
- **Restart mid-job.** Use a second CV, target role `Restart Probe`. Create it and open its page in one `browser_run_code_unsafe` that returns once `Writing your CV` shows. Then, in one Bash call, `"$V" psql "select status, attempts from jobs where cv_id='<id>'"`, which must print `running|1`, then `"$V" restart`, then the same query, which prints `running|2` or `queued|1`, and `"$V" logs --tail 40 | grep -o '"requeued":[0-9]*'`, which prints `"requeued":1`. Save all of it into `$EV`.
- **Recovery.** Stay on the page without reloading. `browser_wait_for` text `Download PDF`, repeated until it succeeds, or `waitFor({ timeout: 60000 })` in `browser_run_code_unsafe`. The draft reruns from the start. The panel is gone and the editor shows, on the same URL. `"$V" psql` now prints `done|2`. Screenshot and `browser_snapshot`.
- **Failed state.** Drive it with a model that does not exist, as in `retry-and-errors.md`, Failed job.

## Gotchas

- The real draft is short. The restart must land between the first `running|1` and the end of the draft, so run the query and the restart in one Bash call right after the page shows `Writing your CV`. If the first query already prints `done|1`, the restart was not exercised. Report that and rerun with a fresh CV. Do not report it passed.
- `"$V" restart` keeps the container's environment. A bare `docker compose` command targets the operator's `ai-cv-builder` project, not this one.
- The page keeps polling through the restart. A poll that fails while the server is down shows the alert `Lost contact with the server. Reconnecting…` above the panel, which stays. The alert clears on the next good poll. That is expected, not a failure, unless it stays.
- `attempts` counts claims, so a restart that lands while the job is `queued` leaves `attempts` at 1 and proves nothing about recovery. Restart only after `running|1`.
- The counter is derived from the browser clock and the job's `createdAt`. A skewed Docker VM clock shows an odd starting number. The order of states is the proof, not the number.
