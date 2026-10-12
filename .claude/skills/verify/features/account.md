# Account

A visitor creates an account with an email and a password, lands signed in on their CV list, logs out, and logs back in. Wrong credentials and a taken email show an error on the form, and signed-in pages send a signed-out visitor to the login page.

## Sub-features

- `account-signup` creates an account and signs the user in.
- `account-signup-duplicate` rejects an email that already has an account, in any letter case.
- `account-signup-short-password` rejects a password under 8 characters.
- `account-login` signs an existing user in.
- `account-login-wrong` shows one error for a wrong password and for an unknown email.
- `account-logout` ends the session and returns to the login page.
- `account-guard` redirects a signed-out visit to a signed-in page to `/login`.

## How to get to it (user POV)

- Open `/signup`, or choose `Create an account` on `/login`.
- Open `/login`, or choose `Log in` on `/signup`.
- Choose `Log out` in the top bar of any signed-in page.
- Open `/`, `/cvs/new` or `/cvs/<id>` while signed out.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold, and the browser is signed out.
- `EMAIL=verify-<timestamp>@example.com`, `PASSWORD=verify-pass-1`.

- **Sign up.** `browser_navigate` to `$B/signup`. `browser_fill_form` with `role=textbox[name="Email"]` = `$EMAIL` and `role=textbox[name="Password"]` = `$PASSWORD`. Screenshot. `browser_click` `role=button[name="Sign up"]`. The URL becomes `$B/`, the heading reads `Your CVs`, the banner shows `$EMAIL` and `Log out`, and the text `You have no CVs yet.` appears.
- **Session is real.** After sign up, `browser_evaluate` `() => fetch('/api/me').then(r => r.json())` returns `{id, email: $EMAIL}`.
- **Log out.** `browser_click` `role=button[name="Log out"]`. The URL becomes `$B/login` and the heading reads `Log in`.
- **Guard.** `browser_navigate` to `$B/cvs/new`. The URL becomes `$B/login`.
- **Wrong password.** On `/login`, fill `Email` with `$EMAIL` and `Password` with `wrong-pass-1`, then `browser_click` `role=button[name="Log in"]`. The text `Wrong email or password.` appears and the URL stays `/login`.
- **Unknown email.** Repeat with `nobody-<timestamp>@example.com`. The same `Wrong email or password.` appears.
- **Log in.** Fill the real credentials and choose `role=button[name="Log in"]`. The URL becomes `$B/` and the banner shows `$EMAIL`.
- **Duplicate email.** Log out, open `$B/signup`, and sign up again with `$EMAIL` in upper case. The text `An account with this email already exists.` appears.
- **API checks.** `curl -s -w ' %{http_code}\n' -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"short\"}" $B/api/auth/signup` prints `{"error":"Use at least 8 characters for your password."} 400`. With `-c "$EV/a.jar"` and a fresh email and a valid password it prints the user JSON and `201`. Then `curl -s -b "$EV/a.jar" $B/api/me` prints that user, `curl -s -b "$EV/a.jar" -X POST $B/api/auth/logout -w '%{http_code}'` prints `204`, and `/api/me` with the same jar prints `{"error":"Log in to continue."}`.
- **Proof.** Screenshots of the filled sign-up form, the signed-in list, and the wrong-password error, plus `browser_snapshot` of the signed-in list, all grabbed into `$EV`.

## Gotchas

- On `/login` the heading and the submit button are both named `Log in`, and on `/signup` the footer link is also `Log in`. Always select by role.
- The browser form blocks a short password before any request, because the input has `minLength=8`. Test the server message with curl.
- The email check is case-insensitive at sign up and log in. A different case is the same account.
- The session cookie `sid` lives 30 days in the MCP browser profile. A run starts signed in as whoever the last run used, possibly against a port that now belongs to another instance. Log out first, or expect a redirect to `/login` when the old session is gone.
- `Loading…` uses the single ellipsis character, not three dots.
