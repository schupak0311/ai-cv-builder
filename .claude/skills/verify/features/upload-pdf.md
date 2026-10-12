# Create a CV from a PDF

A signed-in user uploads their current CV as a PDF with selectable text and names a target role. The app extracts the PDF's text as the Source and drafts the CV from it, the same way as pasted text. A file that is not a PDF, an unreadable or scanned PDF, an oversized file and a missing file are each refused with a message on the form, and no CV is created.

## Sub-features

- `upload-default` opens the new CV form in `Upload a PDF` mode.
- `upload-submit` uploads a one-column or two-column PDF and opens the new CV's page.
- `upload-view` drafts the CV from the PDF's text.
- `upload-not-pdf` refuses a renamed non-PDF with `This file is not a PDF.`.
- `upload-no-file` refuses a request with no file with `Choose a PDF file.`.
- `upload-role` refuses a target role under 2 characters.
- `upload-switch` clears an upload error when the user switches to `Paste text`.

## How to get to it (user POV)

- Choose `New CV` on the CV list at `/`, or open `/cvs/new`. `Upload a PDF` is selected by default.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold, and the browser is signed in as a fresh user in your own tab.
- `R` is the absolute path of this checkout, so the fixtures are `$R/test/fixtures/one-column-en.pdf`, `$R/test/fixtures/two-column-en.pdf` and `$R/.claude/skills/verify/fixtures/not-a-pdf.pdf`.

- **Open form.** `browser_navigate` to `$B/cvs/new`. The group `Your background` has radio `Upload a PDF` checked, and a file input named `Your current CV` with the hint `A PDF with selectable text, up to 5 MB and 10 pages.`.
- **Choose file.** `browser_fill_form` with `role=textbox[name="Target role"]` = `Senior Backend Engineer`. `browser_click` `role=button[name=/^Your current CV/]`. The result reports a `[File chooser]` modal. `browser_file_upload` with `paths` = [`$R/test/fixtures/one-column-en.pdf`]. Screenshot.
- **Submit.** `browser_click` `role=button[name="Write my CV"]`. The URL becomes `$B/cvs/<id>` with heading `Senior Backend Engineer`. Record `<id>`.
- **Drafted view.** `browser_wait_for` text `Experience`. The `article` shows heading `Daniel Okafor`, the line `daniel.okafor@example.org · +44 7700 900123`, `Summary` with `Senior Data Engineer`, and `Experience` bullets taken from the PDF, including `Cut nightly warehouse load time from 6 hours to 75 minutes by moving to incremental Spark jobs.`. Screenshot and `browser_snapshot`.
- **Side effect.** `"$V" psql "select source_kind, length(source_text) > 100 from cvs where id='<id>'"` prints `pdf|t`.
- **Two-column PDF.** Repeat Choose file and Submit with `two-column-en.pdf` and target role `Data Engineer`. A CV page opens and drafts. Record what the article shows; column order in the extracted text is the thing to check.
- **Not a PDF.** On `$B/cvs/new`, fill `Target role`, open the chooser, and upload `$R/.claude/skills/verify/fixtures/not-a-pdf.pdf`. `browser_click` `role=button[name="Write my CV"]`. An `alert` reads `This file is not a PDF.` and the URL stays `$B/cvs/new`. Screenshot.
- **Switch clears error.** `browser_click` `role=radio[name="Paste text"]`. The alert is gone and the `/^Your background/` textarea shows.
- **API checks.** With a signed-in jar, `curl -s -b "$EV/a.jar" -w ' %{http_code}\n' -F targetRole="Data Engineer" -F file=@"$R/.claude/skills/verify/fixtures/not-a-pdf.pdf" $B/api/cvs` prints `{"error":"This file is not a PDF."} 422`. Without `-F file=...` it prints `{"error":"Choose a PDF file."} 400`. With `-F targetRole=D` it prints `{"error":"Enter a target role of at least 2 characters."} 400`. With `-F file=@"$R/test/fixtures/one-column-en.pdf"` it prints `{"id":"<uuid>"} 201`. `curl -s -b "$EV/a.jar" $B/api/cvs | jq length` counts only the successful uploads.
- **Proof.** Screenshots of the chosen file before submit, the drafted CV, and the `This file is not a PDF.` alert, plus the psql and curl outputs saved into `$EV`.

## Gotchas

- `browser_file_upload` only works while a file chooser is open. Click the file input first, and pass absolute paths under a directory the MCP may read (the MCP workspace root, here `$HOME`).
- The file input's accessible name includes its hint, so select it with `name=/^Your current CV/`.
- `accept="application/pdf"` does not stop `browser_file_upload` from setting a renamed PNG. The server's `%PDF-` check is what refuses it.
- The browser refuses files over 5 MB before sending, with `The file is larger than 5 MB.`. No fixture covers that or the 10-page limit, or a PDF with no selectable text (`This PDF has no selectable text. Paste your CV as text instead.`). Report those IDs as not driven unless you bring a file.
- The one-column fixture has no `Skills:` line, so the fake draft shows no `Skills` section. Wait on `Experience`, not `Skills`.
- PDF text keeps the PDF's line breaks, so some bullets are fragments such as `quality and cost control.` and section words such as `Experience` show as bullets. That is the fake model reading lines, not an extraction failure.
- The submit button reads `Reading your PDF…` only while the upload request runs, which is usually too short to screenshot.
