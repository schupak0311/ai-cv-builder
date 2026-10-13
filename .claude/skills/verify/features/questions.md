# Questions and Answers

A drafted CV comes with Questions about facts the draft could not find in the Source, such as an employer, dates, education or a location. They show in a `Questions` panel above the editor, grouped by section, each with its own textarea. The user fills in any of them and chooses one `Send answers` button, which sends every filled-in Answer in one request and queues one revise job. The page swaps to the progress panel, which reads `Updating your CV`, and when the job finishes each answered section is rewritten with its Answer, the other sections are unchanged, and the answered Questions move under `Answered`. Unsaved editor edits are saved first, as part of the same send. A Question can be answered once.

## Sub-features

- `questions-panel` lists open Questions by section with a textarea each, and keeps `Send answers` disabled until one holds text other than spaces.
- `questions-send` sends every filled-in Answer in one `POST /api/cvs/<id>/answers` and queues one revise job, shown as `Updating your CV`.
- `questions-land` rewrites each answered section with its Answer's facts, leaves the other sections unchanged, bumps the version by 1, and lists each Question under `Answered` with its Answer.
- `questions-dirty` saves unsaved editor edits first (version +1), then sends, and shows both the edit and the Answer in the form without a reload.
- `questions-save-conflict` shows a failed save's error in the panel with `role=alert` and sends nothing.
- `questions-api` refuses an answered Question with 409, and duplicate ids, more than 8 Answers and an empty list with 400.

## How to get to it (user POV)

- Open a drafted CV at `/cvs/<id>`. The panel sits between the heading and the editor. It shows when the CV has Questions and no job runs, and also above the editor after a failed revise.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold, and the browser is signed in as `$EMAIL`.
- A drafted CV `<id>` with target role `Senior Backend Engineer` from the fixture Source (`create-cv.md`), and the second-client jar `$EV/a.jar` from `edit-cv.md`. Save or discard any edit first.
- Read the Questions with `curl -s -b "$EV/a.jar" $B/api/cvs/<id> | jq -c '.questions[] | {id, section, text}'`. The wording changes on every draft. On Sonnet the fixture gave 7 Questions: 5 for `experience` (employer and title, dates, which role each line belongs to, impact, level), 1 for `education` and 1 for `contact` (city or country). Pick Questions by `section`, and address each textarea as `#answer-<qid>`. Each step below needs a different open Question, so you need at least three in two sections. If the draft has fewer, draft one more CV.
- Write each Answer around a fact you can grep for afterwards: a place, a year, an employer, a degree.

- **Panel.** `role=region[name="Questions"]` has heading `Questions`, the note `Answer any of these and send them together. Each answer rewrites only its section of your CV.`, an `h3` per section with open Questions, and `role=button[name="Send answers"]`, disabled. Fill one textarea with three spaces and `Send answers` stays disabled. Real text enables it.
- **Two sections, one send.** Save the CV first: `curl -s -b "$EV/a.jar" $B/api/cvs/<id> >| "$EV/20-before.json"`. Fill the `contact` Question with `I am based in Manchester, UK.` and the `education` Question with `I studied BSc Computer Science at the University of Leeds from 2012 to 2015.`. Screenshot. `browser_click` `role=button[name="Send answers"]`, then `browser_wait_for` text `Updating your CV`. The editor and the panel are gone and the `status` reads `Updating your CV · <n> s` (or `Waiting to start` for up to 1 s). Screenshot.
- **Land.** `browser_wait_for` text `Answered`, repeated until it succeeds. The panel lists `Contact · <question>` and `Education · <question>`, each with its Answer, and the remaining open Questions above. Then save `"$EV/22-after.json"` the same way and check:
  - `jq -c '{version, location: .content.contact.location, education: .content.education}' "$EV/22-after.json"` shows the version +1, a location containing `Manchester`, and an education entry whose fields hold `Leeds`, `2012` and `2015`.
  - `diff <(jq -S '.content | del(.contact.location, .education)' "$EV/20-before.json") <(jq -S '.content | del(.contact.location, .education)' "$EV/22-after.json")` prints nothing: every other section and contact field is unchanged.
  - `"$V" psql "select kind, status, attempts from jobs where cv_id='<id>' order by created_at"` adds exactly one `revise|done|1` row.
  - In the browser, `browser_run_code_unsafe` `async (page) => [await page.getByRole('textbox', { name: 'Location', exact: true }).first().inputValue(), await page.getByRole('textbox', { name: 'Institution' }).inputValue()]` returns the new location and institution.
- **Unsaved edit and an Answer together.** Save `"$EV/23-before.json"`. Change `role=textbox[name="Phone"]` to `+44 20 7946 1111` and leave it unsaved. The note gains ` Your unsaved edits are saved first.` and the save bar reads `Unsaved changes. The PDF has the saved version.`. Fill an `experience` Question with `I was a Senior Backend Engineer at Brightpay Ltd for all eight years.`, run `browser_evaluate` `() => { window.__noReload = true; }`, and choose `Send answers`. Wait for `Updating your CV`, then for `Download PDF`. Without a reload, `Phone` reads `+44 20 7946 1111`, the first `Employer` reads `Brightpay Ltd`, the save bar status is empty, `Save` is disabled, and `browser_evaluate` `() => window.__noReload` is `true`. The API JSON has the version +2 (the save, then the revise), the new phone, and `Brightpay` in `.content.experience`. A `diff` like the one above, with `del(.experience) | .contact.phone = "X"`, prints nothing.
- **Save conflict.** Change `Phone` again and leave it unsaved, and fill another open Question. From the second client, save a different change (the Conflict command in `edit-cv.md`, with `.contact.name = "Anna Verifier-Conflict"`), which prints `{"version":<n>} 200`. Choose `Send answers`. The panel shows `role=alert` `This CV changed somewhere else. Reload to get the latest version.`, the save bar shows the same text and `Reload`, the typed Answer stays in its textarea, and `Send answers` is enabled again. Screenshot. `"$V" psql "select count(*) from jobs where cv_id='<id>' and kind='revise'"` is unchanged and that Question's `answer` is still `null`. Choose `Reload` to continue.
- **API refusals.** Each `curl -s -b "$EV/a.jar" -X POST -H 'content-type: application/json' -d '<body>' -w ' %{http_code}\n' $B/api/cvs/<id>/answers`, with these bodies:
  - an answered `<qid>`, `{"answers":[{"questionId":"<qid>","answer":"again"}]}`, prints `{"error":"This question already has an answer."} 409`.
  - one open `<qid>` twice prints `{"error":"Answer each question only once."} 400`.
  - nine distinct valid UUIDs, built with `for i in 1 2 3 4 5 6 7 8 9; do printf '{"questionId":"00000000-0000-4000-8000-00000000000%s","answer":"x"}' $i; done | jq -sc '{answers: .}'`, prints `{"error":"Send at most 8 answers at a time."} 400`.
  - `{"answers":[]}`, and an Answer of three spaces, print `{"error":"Write an answer first."} 400`.
  - an unknown UUID prints `{"error":"Question not found."} 404`.

  None of them queues a job. A good send answers `202` with an empty body.
- **Proof.** Screenshots of the filled form, `Updating your CV`, the `Answered` list, the dirty send and the conflict alert, the before and after JSON files, the `jobs` rows, and the curl outputs, all in `$EV`.

## Gotchas

- Never assert the model's wording. Assert the fact the Answer carries, the unchanged JSON of the other sections, the `Answered` list, the versions and the `jobs` rows. The revise keeps every sentence, bullet and item field that it copies word for word from the current CV, so the `diff` of the other sections is exact.
- An Answer in a section that had nothing, such as `experience` from the fixture, can also fill that section from the Source. The Brightpay Answer made one experience entry holding the fixture's three achievement lines as bullets.
- One send with Answers in two sections is one job with one model call per section, and it bumps the version by 1, not 2.
- The Question stays open (`answer: null`) until its revise job finishes. Sending it again while the job runs answers `Wait for the current update to finish.` 409.
- The textareas are labelled by the Question text, which is long and changes per draft. Use `#answer-<qid>` from the API rather than `role=textbox[name="<question>"]`.
- The panel renders only when the CV has at least one Question, has content, and has no running job. While the revise runs it is gone, so do not wait on it right after `Send answers`.
- A failed revise shows the job's error and `Try again` above the panel and the editor, and the CV list shows that CV as `Failed` although it still has content. `retry-and-errors.md` drives it.
