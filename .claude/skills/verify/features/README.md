# AI CV Builder verification map

This directory is the maintained source for verifying what a user of the AI CV Builder sees. Read this index before driving the app, then use the matching feature file as the recipe. `V` is the helper `.claude/skills/verify/verify.sh` called by absolute path, and `B=$("$V" url)`, the project's own host such as `http://ai-cv-builder-verify.localhost:18080`.

The map covers the app as of `main` at `d13845b`: sign up, log in, log out, the CV list and its polling, creating a CV from pasted text or an uploaded PDF, generation progress, the editor with Save and its version conflict, the A4 PDF download, Questions and Answers, retry of a failed job, the error states, delete, and per-user isolation. The real Claude client runs only with a key, so this map drives the fake model. The one exception is real mode with the dummy key, which is the free way to make a job fail (`retry-and-errors.md`).

## Baseline preconditions

- `"$V" up` succeeded and `"$V" doctor` exits 0 with `LLM_MODE=fake`.
- `EV=$("$V" evidence)` names this run's evidence directory.
- You drive your own browser tab on `$B`, opened with `browser_tabs` action `new` (see the SKILL.md Drive section).
- The browser viewport is 1280 by 800 (`browser_resize`), unless the step is the phone check.
- The browser is signed out. Navigate to `$B/login` and, if the banner shows `Log out`, choose it.
- Each run uses fresh emails, `verify-<timestamp>@example.com` and `verify-<timestamp>-b@example.com`.

## Driving conventions

- Browser actions use the Playwright MCP tools with selector strings as `target`, such as `role=button[name="Sign up"]`.
- API actions use `curl` with a cookie jar per user, `-c "$EV/a.jar"` on sign up and `-b "$EV/a.jar"` after.
- Database reads go through `"$V" psql`. Never write to the database to set up a state.
- Wait on visible text with `browser_wait_for`. The CV page polls every 2 s while a job runs.
- The default fake draft takes 5 s. The restart recipe needs `FAKE_LLM_DELAY_MS=20000`, and the poll-failure and list-poll recipes need `30000`.
- Drafted CV fields are textboxes. `browser_wait_for` sees text, not values, so wait on `Download PDF` and read values from a snapshot or `browser_evaluate`.

## Proof and skip reporting

- Capture the action and the resulting state: a screenshot before the submit and after the result, plus an ARIA snapshot of the result.
- Mutation proof includes a second read: the CV list, `curl $B/api/cvs/<id>`, or a `jobs` row.
- Copy each MCP file into `$EV` with `"$V" grab`, named by step number and feature ID.
- The phone checks, a screenshot at 390 by 844 and a `scrollWidth` reading of at most 390, are in `create-cv.md` and `edit-cv.md`.
- Report each feature ID you drove, and each one you skipped with the reason. Do not report an entry point as verified through a different one.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with Playwright MCP and curl` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Account](./account.md) covers sign up, log in, log out, wrong passwords, duplicate emails and the signed-out redirect.
- [Create a CV from text](./create-cv.md) covers the new CV form, its validation, the drafted CV view and the CV list.
- [Create a CV from a PDF](./upload-pdf.md) covers uploading a PDF, the drafted CV from its text, and the rejections for a non-PDF, a missing file and a short target role.
- [Generation progress](./generation-progress.md) covers the progress panel, reload during a job, and recovery after `docker compose restart app` mid-job.
- [Edit a CV](./edit-cv.md) covers the editor's fields, Save, list add and remove, the version conflict and its Reload, and the phone layout.
- [Download the CV as a PDF](./pdf-export.md) covers the browser download, the A4 page size and text check with `unpdf`, and the refusals.
- [Questions and Answers](./questions.md) covers the Questions panel, the revise job's `Updating your CV`, the Answer landing in its section, and the one-answer rule.
- [Retry and error states](./retry-and-errors.md) covers a failed job and `Try again`, `CV not found.`, the reconnecting alert, the expired session, the account check, and the list's polling.
- [Delete a CV](./delete-cv.md) covers the confirm dialog, cancel, and removal from the list.
- [Per-user isolation](./isolation.md) covers another user's CVs being invisible in the API and the browser, and refused for save, PDF, retry and Answer.
