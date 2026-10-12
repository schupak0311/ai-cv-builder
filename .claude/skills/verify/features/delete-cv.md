# Delete a CV

A user deletes one of their CVs from its page after confirming a dialog. The CV disappears from their list and its page no longer opens. Cancelling the dialog keeps it.

## Sub-features

- `delete-cancel` keeps the CV when the user dismisses the confirm dialog.
- `delete-confirm` deletes the CV, returns to the list, and drops it from the list.
- `delete-gone` shows the heading `CV not found.` and a `Back to your CVs` link on the deleted CV's URL.

## How to get to it (user POV)

- Choose `Delete` at the top of a CV page at `/cvs/<id>`.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold, and the browser is signed in.
- The user owns a CV with target role `Delete Me`, created in the browser or with the Create by API step of `create-cv.md`. Its id is `<id>`.

- **Cancel.** On `$B/cvs/<id>`, `browser_click` `role=button[name="Delete"]`. A confirm dialog reads `Delete this CV? This cannot be undone.`. `browser_handle_dialog` with `accept: false`. The page stays on `$B/cvs/<id>` with heading `Delete Me`.
- **Confirm.** `browser_click` `role=button[name="Delete"]`, then `browser_handle_dialog` with `accept: true`. The URL becomes `$B/` and the list has no `Delete Me` link. Screenshot.
- **Gone.** `browser_navigate` to `$B/cvs/<id>`. The page shows heading `CV not found.`, link `Back to your CVs`, and no `Delete`. `curl -s -b "$EV/a.jar" -w ' %{http_code}\n' $B/api/cvs/<id>` prints `{"error":"CV not found."} 404`, and `"$V" psql "select count(*) from jobs where cv_id='<id>'"` prints `0`.

## Gotchas

- The `Delete` click returns with a `Modal state` naming the `"confirm"` dialog. Call `browser_handle_dialog` next, before any other tool.
- Deleting is allowed while a draft is running. The worker finds no CV and drops the job silently.
