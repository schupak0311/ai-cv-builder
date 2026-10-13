# Edit a CV

Once a CV is drafted, its page is an editor. Every field is a textbox, every list has add and remove controls, and nothing is stored until the user chooses `Save`. The save carries the version the page loaded. If the CV changed somewhere else since then, such as in another tab, the save is refused with `This CV changed somewhere else. Reload to get the latest version.` and a `Reload` button that loads the latest version and drops the unsaved draft. On a phone the fields stack in one column and the summary and bullet fields grow to fit their text.

## Sub-features

- `edit-fields` shows the draft as editable fields: contact, links, summary, experience with bullets, education, skills.
- `edit-dirty` marks unsaved changes with `Unsaved changes. The PDF has the saved version.` and enables `Save`.
- `edit-save` stores the edit, shows `Saved.`, and bumps the CV's version by 1.
- `edit-lists` adds and removes links, bullets, experience entries, education entries and skills.
- `edit-conflict` refuses a save from a stale version with a 409 and shows `Reload`.
- `edit-reload` loads the latest version, drops the draft, and hides `Reload`.
- `edit-busy` refuses a save while a draft or revise job runs with `Wait for the current update to finish.`.
- `edit-phone` lays the editor out at 390 by 844 with no horizontal scroll, 44 px controls, and growing text areas.

## How to get to it (user POV)

- Open a drafted CV from the CV list at `/`, or stay on `/cvs/<id>` after creating one until the draft lands.
- The save bar sticks to the bottom of the window and holds the status text, `Reload` after a conflict, `Download PDF` and `Save`.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold, and the browser is signed in as a fresh user `$EMAIL` with password `$PASSWORD`.
- A drafted CV `<id>` from the browser path in `create-cv.md`, with the fixture Source.
- A second client logged in as the same user, `curl -s -c "$EV/a.jar" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" $B/api/auth/login`. It gets its own session, so it does not touch the browser's cookie.

- **Fields.** On `$B/cvs/<id>`, the editor shows textboxes `Name` = `Anna Verifier`, `Email`, `Phone`, `Location` (empty), `Link 1`, `Summary`, the `Experience` and `Education` cards (on Sonnet both held only their `Add` button for the fixture, since it names no employer and no school), and `Skill 1` to `Skill 5`. `Save` is disabled. Screenshot full page.
- **Edit.** `browser_fill_form` `role=textbox[name="Summary"]` with the old summary plus ` Verified edit <ts>.`. The `status` in the save bar reads `Unsaved changes. The PDF has the saved version.` and `Save` is enabled.
- **Save.** `browser_click` `role=button[name="Save"]`, then `browser_wait_for` text `Saved.`. Screenshot. `curl -s -b "$EV/a.jar" $B/api/cvs/<id> | jq -c '{version, summary: .content.summary}'` shows the new summary and `version` 3. A new CV starts at 1 and the finished draft bumps it to 2.
- **Conflict.** Change a field in the browser and leave it unsaved, for example `role=textbox[name="Phone"]` = `+44 20 7946 0000`. From the second client, save a different change on the current version:

  ```bash
  curl -s -b "$EV/a.jar" $B/api/cvs/<id> \
    | jq -c '{content: (.content | .contact.name = "Anna Verifier-Curl"), version}' \
    | curl -s -b "$EV/a.jar" -X PUT -H 'content-type: application/json' -d @- -w ' %{http_code}\n' $B/api/cvs/<id>
  ```

  It prints `{"version":4} 200`. Now `browser_click` `role=button[name="Save"]`. The status reads `This CV changed somewhere else. Reload to get the latest version.` and `role=button[name="Reload"]` shows beside `Download PDF` and `Save`. Screenshot.
- **Reload.** `browser_click` `role=button[name="Reload"]`. `Name` reads `Anna Verifier-Curl`, `Phone` is back to `+44 20 7946 0958`, the status is empty, `Reload` is gone and `Save` is disabled. Read the values with `browser_evaluate` and save it with `filename`.
- **Lists.** Read `curl ... | jq -c .content.skills` first. `browser_click` `role=button[name="Add skill"]`, fill the new last `Skill <n+1>` = `Rust`, `browser_click` `role=button[name="Remove skill 1"]`, then `Save` and wait for `Saved.`. The skills are now the old list without its first item, plus `Rust`. From the fixture that is `["Go","Postgres","Kafka","AWS","Rust"]`. The same pattern drives `Add link` and `Remove link <n>`, `Add bullet` and `Remove bullet <n>`, `Add experience` and `Remove this experience`, `Add education` and `Remove this education`.
- **Busy.** While a draft or revise runs, the editor is hidden, so test it by API. A `PUT` with the current version answers `{"error":"Wait for the current update to finish."} 409`.
- **Phone.** `browser_resize` 390 by 844, full-page screenshot, and `browser_evaluate` `() => ({ scrollWidth: document.documentElement.scrollWidth, grow: [...document.querySelectorAll('.editor textarea')].map(t => t.offsetHeight >= t.scrollHeight), minControl: Math.min(...[...document.querySelectorAll('button, a.button, input, textarea')].filter(e => e.offsetParent).map(e => e.offsetHeight)) })`. `scrollWidth` is at most 390, every `grow` entry is `true` (the fixture summary wraps to about 190 px), and `minControl` is 44. `browser_resize` back to 1280 by 800.

## Gotchas

- `browser_wait_for` matches visible text, not textbox values. Wait on a handle such as `Download PDF` or `Saved.`, then read values with `browser_evaluate` or a snapshot.
- `Location` is the name of both the contact field and each experience entry's field. `Start` and `End` repeat for every experience and education entry. Scope by card, or use `>> nth=<n>`.
- List items are numbered from 1 per list, and bullets restart at 1 for each experience entry. After a remove, the remaining items are renumbered.
- `Summary` is both an `h2` and the textbox's hidden label. Select by role.
- Editing a field back to its saved value clears the dirty state, and `Save` disables again.
- The 409 response logs one console error in the browser. That is the failed request, not a page error.
- In a full-page screenshot at phone width, the sticky save bar is drawn where the first viewport ends, over a card. That is the capture, not the layout.
- The PDF always renders the saved version. Save before downloading.
