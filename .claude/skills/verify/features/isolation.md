# Per-user isolation

Each user sees and changes only their own CVs. Another user's CV is indistinguishable from one that does not exist: it is missing from the list, its page shows `CV not found.`, and deleting it fails the same way. Signed-out requests get nothing.

## Sub-features

- `iso-list` lists only the signed-in user's CVs.
- `iso-read` answers `CV not found.` for another user's CV, in the API and on its page.
- `iso-delete` refuses to delete another user's CV and leaves it in place.
- `iso-anon` answers `Log in to continue.` to every CV route without a session.

## How to get to it (user POV)

- Sign in as user B and open user A's CV URL in the browser.
- Call the API with user B's session.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold.
- Two cookie jars from two curl sign-ups, `$EV/a.jar` for `verify-<ts>@example.com` and `$EV/b.jar` for `verify-<ts>-b@example.com`, as in `account.md`, API checks.
- User A owns CV `<id>` with target role `Platform Engineer`, from the Create by API step of `create-cv.md`.

- **API read.** `curl -s -b "$EV/b.jar" -w ' %{http_code}\n' $B/api/cvs/<id>` prints `{"error":"CV not found."} 404`.
- **API delete.** `curl -s -b "$EV/b.jar" -X DELETE -w ' %{http_code}\n' $B/api/cvs/<id>` prints `{"error":"CV not found."} 404`.
- **API list.** `curl -s -b "$EV/b.jar" $B/api/cvs` prints `[]`.
- **Still there for A.** `curl -s -b "$EV/a.jar" $B/api/cvs/<id> | jq -c '{targetRole}'` prints `{"targetRole":"Platform Engineer"}`.
- **Anonymous.** `curl -s -w ' %{http_code}\n'` against `$B/api/cvs`, `$B/api/cvs/<id>`, and with `-X DELETE` against `$B/api/cvs/<id>`, each print `{"error":"Log in to continue."} 401`.
- **Browser.** Log in as user B in the browser (`account.md`, Log in). The list shows `You have no CVs yet.`. `browser_navigate` to `$B/cvs/<id>`. The page shows `CV not found.` and no `Platform Engineer` heading. Screenshot and `browser_snapshot`.
- **Proof.** Save every curl output above into `$EV/isolation.txt` with the command beside it.

## Gotchas

- `-c` writes the jar and `-b` reads it. Sign up with `-c`, then use `-b` on every later call, or each call runs signed out and passes for the wrong reason (401 instead of 404).
- A malformed id such as `/api/cvs/abc` also answers `CV not found.` 404, so use a real id from user A to prove isolation.
- Logging out with curl does not clear the jar file. The server deleted the session, so later calls with that jar get 401.
