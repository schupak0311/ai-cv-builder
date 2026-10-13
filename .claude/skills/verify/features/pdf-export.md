# Download the CV as a PDF

On a drafted CV's page, the `Download PDF` link in the save bar downloads the saved CV as an A4 PDF with an embedded Noto Sans font. The file is named after the CV's name, such as `Anna Verifier CV.pdf`. It holds the name, a contact line, and the Summary, Experience, Education and Skills sections that have content. Unsaved edits are not in it.

## Sub-features

- `pdf-download` links the browser to the PDF, served with the CV's name in the filename. The MCP cannot complete a browser download, so the link and the served file are checked separately.
- `pdf-a4` renders every page at 595.28 by 841.89 points.
- `pdf-content` contains the saved content, including a saved edit.
- `pdf-refuse` answers 401 signed out, 404 for a missing or another user's CV, and 409 `This CV has no content yet.` while the first draft runs.

## How to get to it (user POV)

- Choose `Download PDF` in the save bar of a drafted CV at `/cvs/<id>`. It is hidden while a job runs and on a failed first draft.

## Driving it with Playwright MCP and curl

Preconditions:

- Baseline preconditions from the README hold, and the browser is signed in.
- A drafted CV `<id>` with a saved edit, from `edit-cv.md` Save. `EDIT` is a phrase from that edit, such as `Verified edit <ts>.`.
- `S` is your session scratchpad. Write this throwaway checker to `$S/check-pdf.mjs`. It is not part of the skill, and it runs inside the app container, which has `unpdf`:

  ```js
  import { getDocumentProxy, extractText } from "unpdf";

  const expected = process.argv[1];
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const size = bytes.length;
  const doc = await getDocumentProxy(bytes);
  const sizes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const [x0, y0, x1, y1] = (await doc.getPage(i)).view;
    sizes.push([+(x1 - x0).toFixed(2), +(y1 - y0).toFixed(2)]);
  }
  const { text } = await extractText(doc, { mergePages: true });
  const a4 = sizes.every(([w, h]) => w === 595.28 && h === 841.89);
  const hasEdit = Boolean(expected) && text.replace(/\s+/g, " ").includes(expected);
  console.log(JSON.stringify({ bytes: size, pages: doc.numPages, sizes, a4, expected, hasEdit, text }, null, 2));
  process.exit(a4 && hasEdit ? 0 : 1);
  ```

- **Download.** Do not click `Download PDF` in the browser. The Playwright MCP crashes on the download with `Cannot read properties of undefined (reading 'url')` and resets every tab. Check the link instead: `browser_evaluate` `() => { const a = document.querySelector('a[download]'); return [a.getAttribute('href'), a.textContent]; }` returns `["/api/cvs/<id>/pdf","Download PDF"]`. Then fetch the same URL with the account's jar: `curl -s -b "$EV/a.jar" -o "$EV/11-cv.pdf" $B/api/cvs/<id>/pdf`.
- **Check.** `"$V" node "$S/check-pdf.mjs" "$EDIT" < "$EV/11-cv.pdf" >| "$EV/11-pdf-check.json"; echo $?` prints `0`, and `jq -c '{bytes,pages,sizes,a4,hasEdit}' "$EV/11-pdf-check.json"` shows `"a4":true,"hasEdit":true` with every size `[595.28,841.89]`. The `text` field reads the name, `email · phone · link`, then a heading for each section with content: `Summary` and `Skills` for a fresh fixture draft, plus `Experience` and `Education` once Answers fill them. Run it once more with a phrase that is not in the CV and confirm it exits `1`, so a pass means something.
- **Headers.** `curl -s -b "$EV/a.jar" -D - -o /dev/null $B/api/cvs/<id>/pdf` shows `content-type: application/pdf` and `content-disposition: attachment; filename="<Name> CV.pdf"; filename*=UTF-8''<Name%20CV.pdf>`.
- **Refusals.** Without a jar, `curl -s -w ' %{http_code}\n' $B/api/cvs/<id>/pdf` prints `{"error":"Log in to continue."} 401`. With the jar and `00000000-0000-4000-8000-000000000000` as the id it prints `{"error":"CV not found."} 404`. On a CV created a moment ago, called before the draft lands, it prints `{"error":"This CV has no content yet."} 409`. A real draft lands in about 6 s, so make this call right after the create, in the same tool call, as the Start a draft step of `generation-progress.md` does.
- **Proof.** `11-cv.pdf`, `11-pdf-check.json` and the curl outputs in `$EV`.

## Gotchas

- The MCP saves the download under its own `.playwright-mcp/` folder, not the evidence directory. Grab it like a screenshot.
- The agent shell is zsh with `noclobber`, so `>` onto an existing evidence file fails. Use `>|` or a new name.
- pdf.js detaches the byte buffer it parses, so a checker that reads `bytes.length` after `getDocumentProxy` reports 0. Read the size first, as the script above does.
- A fresh worktree has no `node_modules`. Rather than installing, `"$V" node` runs the script in the app container, where `unpdf` is a runtime dependency. Do not borrow another checkout's `node_modules`.
- A revise job does not hide the PDF from the API. Only a CV with no content yet gets the 409.
