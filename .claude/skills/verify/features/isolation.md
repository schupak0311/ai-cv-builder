# Per-user isolation

Each user sees and changes only their own CVs. Another user's CV is indistinguishable from one that does not exist: it is missing from the list, its page shows `CV not found.`, and deleting, saving, downloading or retrying it fails the same way. Signed-out requests get nothing.

## Sub-features

- `iso-list` lists only the signed-in user's CVs.
- `iso-read` answers `CV not found.` for another user's CV, in the API and on its page.
- `iso-delete` refuses to delete another user's CV and leaves it in place.
- `iso-write` refuses another user's save, PDF, retry and Answer.
- `iso-anon` answers `Log in to continue.` to every CV route without a session.

## How to get to it (user POV)

- Sign in as user B and open user A's CV URL in the browser.
- Call the API with user B's session.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold.
- Two cookie jars from two curl sign-ups, `$EV/a.jar` for `verify-<ts>@example.com` and `$EV/b.jar` for `verify-<ts>-b@example.com`, as in `account.md`, API checks.
- User A owns a drafted CV `<id>` with at least one open Question. Reuse the CV from `create-cv.md` rather than drafting another, since every draft is a paid Claude call. `<role>` is its target role, `Senior Backend Engineer` for that CV.

- **API read.** `curl -s -b "$EV/b.jar" -w ' %{http_code}\n' $B/api/cvs/<id>` prints `{"error":"CV not found."} 404`.
- **API delete.** `curl -s -b "$EV/b.jar" -X DELETE -w ' %{http_code}\n' $B/api/cvs/<id>` prints `{"error":"CV not found."} 404`.
- **API list.** `curl -s -b "$EV/b.jar" $B/api/cvs | jq -c 'map(.targetRole)'` does not contain `"<role>"`. It prints `[]` unless user B created a CV in another feature, such as `retry-and-errors.md`.
- **API writes.** With `-b "$EV/b.jar" -w ' %{http_code}\n'`: `GET $B/api/cvs/<id>/pdf` and `-X POST $B/api/cvs/<id>/retry` print `{"error":"CV not found."} 404`. A `-X PUT` with A's content and version, `curl -s -b "$EV/a.jar" $B/api/cvs/<id> | jq -c '{content, version}' | curl -s -b "$EV/b.jar" -X PUT -H 'content-type: application/json' -d @- -w ' %{http_code}\n' $B/api/cvs/<id>`, prints `{"error":"CV not found."} 404`. `-X POST -H 'content-type: application/json' -d '{"answers":[{"questionId":"<qid>","answer":"x"}]}' $B/api/cvs/<id>/answers`, with an open `<qid>` from A's CV, prints `{"error":"Question not found."} 404`, and A's Question still has `answer: null`.
- **Still there for A.** `curl -s -b "$EV/a.jar" $B/api/cvs/<id> | jq -c '{targetRole}'` prints `{"targetRole":"<role>"}`.
- **Anonymous.** `curl -s -w ' %{http_code}\n'` against `$B/api/cvs`, `$B/api/cvs/<id>`, with `-X DELETE` against `$B/api/cvs/<id>`, and with `-X POST` against `$B/api/cvs/<id>/answers`, each print `{"error":"Log in to continue."} 401`.
- **Browser.** Log in as user B in the browser (`account.md`, Log in). The list does not show `<role>`. `browser_navigate` to `$B/cvs/<id>`. The page shows heading `CV not found.`, no `<role>` heading, and no `Delete`. Screenshot and `browser_snapshot`.
- **Proof.** Save every curl output above into `$EV/isolation.txt` with the command beside it.

## Gotchas

- `-c` writes the jar and `-b` reads it. Sign up with `-c`, then use `-b` on every later call, or each call runs signed out and passes for the wrong reason (401 instead of 404).
- A malformed id such as `/api/cvs/abc` also answers `CV not found.` 404, so use a real id from user A to prove isolation.
- A `PUT` with an invalid body answers 400 before the ownership check. Send A's real content, or a 400 passes for the wrong reason.
- Logging out with curl does not clear the jar file. The server deleted the session, so later calls with that jar get 401.
