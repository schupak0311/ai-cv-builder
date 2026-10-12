# Create a CV from text

A signed-in user pastes their background, names a target role, and gets a CV drafted from that text alone. The CV page shows the target role as its heading and, once drafted, an editor whose fields hold the name, contact details, summary, experience bullets and skills, each taken from the pasted text. Editing that draft is `edit-cv.md`. The CV list shows the new CV with its status.

## Sub-features

- `create-open` opens the new CV form from the CV list.
- `create-text-mode` switches the form from the default PDF upload to pasted text.
- `create-validate` rejects a target role under 2 characters and a background under 50 characters.
- `create-submit` creates the CV and opens its page.
- `create-view` fills the editor with every field the Source supports.
- `create-list` lists the CV by target role with `Ready` once drafted.
- `create-phone` lays the CV page out at 390 by 844 with no horizontal scroll.

## How to get to it (user POV)

- Choose `New CV` on the CV list at `/`.
- Open `/cvs/new` directly while signed in.
- Choose a CV's target-role link on the CV list to reopen it.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold, and the browser is signed in as a fresh user (see `account.md`, Sign up).
- `SOURCE` is the contents of `"$(dirname "$V")/fixtures/source.txt"`.

- **Open form.** `browser_click` `role=link[name="New CV"]`. The URL becomes `$B/cvs/new` and the heading reads `New CV`.
- **Paste mode.** `browser_click` `role=radio[name="Paste text"]`. The file input is replaced by the `/^Your background/` textarea and its counter `0 / 20,000 characters`.
- **Fill form.** `browser_fill_form` with `role=textbox[name="Target role"]` = `Senior Backend Engineer` and `role=textbox[name=/^Your background/]` = `$SOURCE`. The counter below the textarea reads `<n> / 20,000 characters` with `n` above 50. Screenshot.
- **Submit.** `browser_click` `role=button[name="Write my CV"]`. The URL becomes `$B/cvs/<id>`, the heading reads `Senior Backend Engineer`, and the `status` region shows `Waiting to start` or `Writing your CV`. Record `<id>` from the URL.
- **Drafted view.** `browser_wait_for` text `Download PDF`, which shows only once the editor renders. The progress text is gone, and `browser_snapshot` shows the `Questions` region above the editor and textboxes `Name` = `Anna Verifier`, `Email` = `anna.verifier@example.com`, `Phone` = `+44 20 7946 0958`, `Link 1` = `https://github.com/anna-verifier`, `Summary` = `Backend engineer with eight years building payment APIs in TypeScript and Go.`, `Bullet 1` to `Bullet 3` with the three remaining lines, and `Skill 1` to `Skill 5` = `TypeScript`, `Go`, `Postgres`, `Kafka`, `AWS`. Screenshot full page and `browser_snapshot` with `filename` `cv.aria.yml`.
- **Side effect.** `"$V" psql "select kind, status, attempts from jobs where cv_id='<id>'"` prints `generate|done|1`. `browser_evaluate` `() => fetch(location.pathname.replace('/cvs/', '/api/cvs/')).then(r => r.json())` returns `version: 2`, `job: null`, `error: null`, and one question `{section: "summary", text: "What makes you a strong fit for the Senior Backend Engineer role?", answer: null}`. Save it with the tool's `filename`, then grab it.
- **List.** `browser_click` `role=link[name="AI CV Builder"]`. The list shows a link `Senior Backend Engineer` with `Ready · <today>` beside it. Choosing it reopens `$B/cvs/<id>` with the same CV.
- **Phone.** On `$B/cvs/<id>`, run the Phone step of `edit-cv.md`.
- **Validation.** `curl -s -b "$EV/a.jar" -w ' %{http_code}\n' -H 'content-type: application/json' -d '{"targetRole":"X","sourceText":"short"}' $B/api/cvs` prints `{"error":"Enter a target role of at least 2 characters."} 400`. A valid role with a short text prints `Describe your background in at least 50 characters.`. In the browser, a short text keeps you on `/cvs/new` because the textarea is `required` with `minLength=50`.
- **Create by API.** For setup in other recipes, `curl -s -b "$EV/a.jar" -H 'content-type: application/json' --data-binary @<(jq -n --rawfile s "$(dirname "$V")/fixtures/source.txt" '{targetRole:"Platform Engineer",sourceText:$s}') $B/api/cvs` prints `{"id":"<uuid>"}`.

## Gotchas

- The form opens in `Upload a PDF` mode. Without choosing `Paste text` first there is no textarea to fill, and `Write my CV` is blocked by the required file input.

- The background textbox's accessible name includes the live counter, such as `Your background 0 / 20,000 characters`. Select it with the regex `name=/^Your background/`.
- The fake model reads the Source line by line. Line 1 is the name if it is short and has no email or phone, a `Skills:` line becomes skills, lines with an email, a phone or a URL feed only the contact line, the first remaining line is the summary, and the rest become up to eight bullets with no employer or title. A one-line Source renders almost nothing, so use the fixture.
- The experience entry has empty `Title`, `Employer`, `Location`, `Start` and `End` fields, and `Education` has no entries. That is the fake draft, not a rendering bug.
- `browser_wait_for` sees visible text only, not textbox values, so `Anna Verifier` never matches. `Skills` matches the card heading even before the draft fills it. Wait on `Download PDF`, then read the values from a snapshot.
- The list date uses the browser's locale.
- `status` can read `Waiting to start` for up to 1 s, because the worker polls the queue every second when idle.
