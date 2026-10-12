# Questions and Answers

A drafted CV comes with Questions about gaps the draft could not fill from the Source. They show in a `Questions` panel above the editor, grouped by section. Answering one queues a revise job: the page swaps to the progress panel, which reads `Updating your CV`, and when the job finishes the Answer is in that section of the CV and the Question moves under `Answered`. A Question can be answered once.

## Sub-features

- `questions-panel` lists open Questions by section, each with a textbox named by the Question and an `Answer` button.
- `questions-answer` queues a revise job and shows `Updating your CV` in the progress panel.
- `questions-land` puts the Answer into its section and lists the Question under `Answered` with its Answer.
- `questions-once` refuses a second Answer with `This question already has an answer.`.
- `questions-dirty` disables `Answer` and shows `Save or discard your edits before answering a question.` while the editor has unsaved changes.

## How to get to it (user POV)

- Open a drafted CV at `/cvs/<id>`. The panel sits between the heading and the editor and shows only when the CV has Questions and no job runs.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold, and the browser is signed in.
- A drafted CV `<id>` with target role `Senior Backend Engineer` from the fixture Source, and the second-client jar `$EV/a.jar` from `edit-cv.md`.
- Save or discard any edit first. While the editor has unsaved changes every `Answer` button and a failed job's `Try again` are disabled, and the panel note reads `Save or discard your edits before answering a question.`, because the revised CV replaces the editor's draft.

- **Panel.** `role=region[name="Questions"]` has heading `Questions`, the note `Answering a question rewrites that section of your CV.`, an `h3` `Summary`, and the textbox `What makes you a strong fit for the Senior Backend Engineer role?` with a disabled `Answer` button.
- **Dirty.** Type into `role=textbox[name="Phone"]` without saving. The note reads `Save or discard your edits before answering a question.` and `Answer` stays disabled after you type an answer. Restore the field so `Save` is disabled again, and the note returns.
- **Answer.** `browser_fill_form` that textbox with `I have run payment systems at scale for eight years.`, then `browser_click` `role=button[name="Answer"]`. `browser_wait_for` text `Updating your CV`. The editor and the panel are gone and the `status` reads `Updating your CV · <n> s` (or `Waiting to start` for up to 1 s). Screenshot.
- **Land.** `browser_wait_for` text `Answered`, repeated until it succeeds. The panel shows `Answered` with `Summary · What makes you a strong fit for the Senior Backend Engineer role?` and the Answer. `browser_evaluate` `() => document.querySelector('textarea[aria-label="Summary"]').value` ends with ` I have run payment systems at scale for eight years.`. Screenshot and `browser_snapshot`.
- **Side effect.** `"$V" psql "select kind, status, attempts from jobs where cv_id='<id>' order by created_at"` prints `generate|done|1` and `revise|done|1`. `curl -s -b "$EV/a.jar" $B/api/cvs/<id> | jq -c '{version, questions}'` shows the Answer on the Question and the version bumped by 1.
- **Once.** `curl -s -b "$EV/a.jar" -X POST -H 'content-type: application/json' -d '{"answer":"again"}' -w ' %{http_code}\n' $B/api/cvs/<id>/questions/<qid>/answer`, with `<qid>` from `.questions[0].id`, prints `{"error":"This question already has an answer."} 409`. A first Answer returns `202` with an empty body.

## Gotchas

- The fake model makes exactly one Question per draft, for `summary`, worded `What makes you a strong fit for the <target role> role?`. Its revise appends the Answer to the summary after one space, verbatim. A real model rewrites the section, so this exact text check holds only in fake mode.
- With the default 5 s delay the revise ends about 6 s after `Answer`. Waiting on `Updating your CV` right after the click catches it. For a screenshot that needs more time, run `FAKE_LLM_DELAY_MS=20000 "$V" up` first.
- The panel renders only when the CV has at least one Question, has content, and has no running job. While the revise runs it is gone, so do not wait on it right after `Answer`.
- Answering while a job runs answers `Wait for the current update to finish.` 409.
