---
name: verify
description: Launch the AI CV Builder (Fastify API plus React SPA in Docker Compose, fake LLM) in this checkout and drive it through a real browser and curl to prove a change works the way a user sees it. Use after changing sign up or log in, the CV list, creating a CV from text or a PDF upload, generation progress, the CV view, delete, or per-user isolation, and whenever asked to run, verify, or screenshot the app.
---

# Verify the AI CV Builder

The app is one web surface: a React SPA and a JSON API served by one Node process on container port 8080, with Postgres beside it. A user signs up, starts a CV from an uploaded PDF or pasted text and a target role, watches a progress panel while a background job drafts it, then reads the CV. There is no CLI. The API under `/api/` is the second surface for side-effect and isolation checks.

Everything goes through the helper `verify.sh` in this folder. It resolves the repo from its own location, so call it by absolute path. Agent shells often reset cwd to a different checkout, and a cwd-relative `docker compose` would drive the wrong project.

```bash
V=<absolute path of this checkout>/.claude/skills/verify/verify.sh
```

Read [`features/README.md`](features/README.md) before driving, then use the matching feature file as the recipe.

## Launch

```bash
"$V" up
```

- It runs `docker compose up -d --build db app` from the repo root with `LLM_MODE=fake`, `ANTHROPIC_API_KEY=dummy`, `FAKE_LLM_DELAY_MS=5000` and a `PORT` it picks: the first port from 18080 upward with no listener. Override any of them in the environment, as in `PORT=18555 "$V" up`.
- Ready means `GET /api/me` on the port answers 401. The server listens only after migrations and job requeue finish, so ready also means migrated. It prints `ready: http://<project>.localhost:<port>`. Later, `B=$("$V" url)` gives that base URL and `"$V" port` the port.
- `up` is idempotent. When the app is already up it reuses it. When you pass a different `FAKE_LLM_DELAY_MS` it recreates only the app container on the same port and keeps the database.
- Compose names the project after the checkout's directory, so each git worktree gets its own containers, network and `db-data` volume (`ai-cv-builder-verify` for a worktree named that). Two worktrees can run side by side on different ports. Never drive an instance another checkout started.
- Never run a bare `docker compose up` here. Without the helper's environment the app container is recreated with `LLM_MODE=real`, which needs a real `ANTHROPIC_API_KEY` in `.env` and exits at boot with `Set ANTHROPIC_API_KEY in .env` without one. Real mode is for a human with a key, and every job then calls Claude and costs money.
- `"$V" restart` runs `docker compose restart app` for this project and waits for ready. It keeps the container's environment.

## Doctor

```bash
"$V" doctor
```

Read-only. It prints the repo, the compose project, `docker compose ps`, the URL, and checks that `/api/me` answers `{"error":"Log in to continue."}`, the SPA is served, `LLM_MODE=fake` with its delay, and the `migrations applied` log line. It also prints the image build time beside `HEAD` so you can spot a stale image. It exits non-zero on any `FAIL`. Run it first, and again whenever something looks off. On failure, read `"$V" logs --tail 80`.

## Drive

Browser: the Playwright MCP tools (`mcp__playwright__*`). Load their schemas with ToolSearch first. API: `curl` with a cookie jar, plus `jq`. Database reads: `"$V" psql "<sql>"`, for side effects only, never to set up state.

- Use `B=$("$V" url)`, which is `http://<project>.localhost:<port>`, in the browser and in curl. Chromium and curl both resolve `*.localhost` to loopback. Never drive `127.0.0.1` or plain `localhost` in the browser. Cookies are scoped by host and not by port, so every instance on `127.0.0.1` shares one `sid` cookie slot, and two runs in a shared browser would sign each other out. The project host gives each worktree its own cookies.
- The Playwright MCP browser may be shared with other agents. Open your own tab with `browser_tabs` action `new` and `url` `$B/login`, and note its index. Before each run of steps, call `browser_tabs` action `list` and `select` your tab if it is not current. After every action, check that the `Page URL` in the result starts with your `$B`. If it does not, another agent is using the browser: stop, reselect your tab, and redo the step. Never navigate, click in, or close a tab whose URL is another host or port. At the end close only your own tab with `browser_tabs` action `close` and its index, never `browser_close`, which ends the browser for everyone.
- Set the viewport before the first screenshot, `browser_resize` 1280 by 800. The MCP browser keeps the last size across sessions, and it may still be 390 wide from a phone check.
- Pass Playwright selector strings as `target` instead of snapshot refs, so the recipes are copyable. `role=button[name="Sign up"]`, `role=link[name="New CV"]` and `role=textbox[name="Email"]` work. In this MCP, `name="Your background"` did not match the textbox whose accessible name ends in the live counter, though Playwright documents quoted names as substring matches. Use a regex when the name has extra text, as in `role=textbox[name=/^Your background/]`.
- Wait with `browser_wait_for` on visible text, not fixed sleeps. It gives up after 5 s, so call it again for a longer wait. Do not pass `time` together with `text`: it sleeps the full `time` first and only then waits for the text.
- Fresh account per run, `verify-<timestamp>@example.com` with a password of at least 8 characters.
- [`fixtures/source.txt`](fixtures/source.txt) is a Source that fills every section the fake model renders: name, contact line, summary, three experience bullets, skills.
- PDF fixtures live in the app's tests: `test/fixtures/one-column-en.pdf` and `test/fixtures/two-column-en.pdf`. [`fixtures/not-a-pdf.pdf`](fixtures/not-a-pdf.pdf) is a 1 by 1 PNG renamed to `.pdf`. Pass absolute paths to `browser_file_upload`.

Pages and handles, read from `web/src/`:

| Route | Handles |
|---|---|
| `/signup` | heading `Create your account`, textboxes `Email` and `Password`, button `Sign up`, link `Log in` |
| `/login` | heading and button both `Log in` (pick by role), link `Create an account`, error `Wrong email or password.` |
| `/` | banner link `AI CV Builder`, the signed-in email, button `Log out`, heading `Your CVs`, link `New CV`, one link per CV named by its target role with `Waiting to start`, `Writing`, `Ready` or `Failed` beside it, empty text `You have no CVs yet.` |
| `/cvs/new` | heading `New CV`, textbox `Target role`, group `Your background` with radios `Upload a PDF` (checked by default) and `Paste text`. With PDF: file input `role=button[name=/^Your current CV/]`, which opens a file chooser for `browser_file_upload`. With text: textbox `/^Your background/`. Button `Write my CV`, which reads `Reading your PDF…` while an upload is sent. Errors show as `role=alert` |
| `/cvs/<id>` | heading is the target role, button `Delete` (opens a confirm dialog), a `status` region reading `Waiting to start` or `Writing your CV` with a seconds counter, then an `article` with headings `Summary`, `Experience`, `Skills` |

Signed-out visits to `/`, `/cvs/new` or `/cvs/<id>` redirect to `/login`. Unknown routes redirect to `/`.

## Evidence

```bash
EV=$("$V" evidence)
```

That makes and prints `/tmp/cv-builder-verify/<YYYYmmdd-HHMMSS>-<project>/`. Override the root with `CV_VERIFY_EVIDENCE_ROOT`. Cleanup never touches it.

The Playwright MCP refuses to write outside its own roots, so a screenshot cannot go straight to `/tmp`. Call `browser_take_screenshot`, `browser_snapshot` or `browser_evaluate` with a `filename` under the MCP's output folder, like `.playwright-mcp/cvb-04-cv.png`, or with none. The result names the saved file, such as `.playwright-mcp/page-<ts>.png` or `cv-list.png`, relative to the MCP workspace root. Copy it in with:

```bash
"$V" grab "$EV" "<path the result printed>" 03-cv-ready.png
```

`grab` tries the path as given, then under `$PLAYWRIGHT_MCP_ROOT`, `$HOME`, the repo and cwd, and moves the file, so nothing is left in the MCP folder. In this environment the MCP root is `$HOME`. When a session's MCP root is a checkout, its `.playwright-mcp/` folder sits inside the repo untracked. Grab every file you save, and never commit that folder.

Proof standards:

- Exercise the user path in the browser. Use curl for setup only where the feature file says so, and for isolation and side-effect checks.
- Capture the action and the resulting state: a screenshot before submitting and after the result appears, plus an ARIA snapshot of the result.
- Check the side effect too. A CV proof includes `curl /api/cvs/<id>` JSON or `"$V" psql "select status, attempts from jobs where cv_id='<id>'"` saved into `$EV`.
- The fake model is the only mock. It sits where the Claude API would, behind the same job queue, so every other part is the real code path.
- Include a phone-width check, `browser_resize` 390 by 844, a screenshot, and `browser_evaluate` of `() => document.documentElement.scrollWidth`, which must be at most 390.
- Name every file with a numbered step and say in your report which feature IDs from the map you drove and which you skipped.

## Cleanup

```bash
"$V" down "$EV"
```

It saves `app.log` and `compose-ps.txt` into `$EV` first, because the container logs go with the containers. Then it runs `docker compose down -v --remove-orphans` from the repo root, which removes this project's containers, network and database volume and nothing else. It never kills by process or container name. Then close your own browser tab by index. Run cleanup after every failed attempt too, then confirm `ls "$EV"` still lists the evidence.

## Helpers

| Command | Does |
|---|---|
| `"$V" up` | Build and start, or reuse, this checkout's instance, and wait for ready |
| `"$V" doctor` | Read-only health check, non-zero on failure |
| `"$V" port` | Print the published port |
| `"$V" url` | Print the base URL, `http://<project>.localhost:<port>` |
| `"$V" evidence` | Create and print a new evidence directory |
| `"$V" grab <dir> <mcp-path> <name>` | Move a file the Playwright MCP saved into the evidence directory |
| `"$V" restart` | `docker compose restart app`, then wait for ready |
| `"$V" logs [--tail N]` | App container logs |
| `"$V" psql "<sql>"` | Run one query against this project's database. Use it for reads only |
| `"$V" down [evidence-dir]` | Save logs into the evidence directory, then `docker compose down -v` |
