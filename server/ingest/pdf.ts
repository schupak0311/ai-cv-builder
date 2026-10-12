import { extractText, getDocumentProxy } from "unpdf";
import { PDF_MAX_PAGES, PDF_TEXT_MIN } from "../../shared/api.js";
import { HttpError } from "../http.js";

const PDF_MAGIC = Buffer.from("%PDF-");

export async function pdfToSource(bytes: Buffer): Promise<string> {
  if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new HttpError(422, "This file is not a PDF.");
  }
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 }).catch(() => {
    throw new HttpError(422, "We could not read this PDF.");
  });
  try {
    if (pdf.numPages > PDF_MAX_PAGES) {
      throw new HttpError(422, `Your CV has more than ${PDF_MAX_PAGES} pages.`);
    }
    const { text } = await extractText(pdf, { mergePages: true }).catch(() => {
      throw new HttpError(422, "We could not read this PDF.");
    });
    const source = text.trim();
    if (source.length < PDF_TEXT_MIN) {
      throw new HttpError(422, "This PDF has no selectable text. Paste your CV as text instead.");
    }
    return source;
  } finally {
    await pdf.loadingTask.destroy();
  }
}
