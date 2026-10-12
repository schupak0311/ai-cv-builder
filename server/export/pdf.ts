import { join } from "node:path";
import pdfmake from "pdfmake";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces.js";
import type { Cv } from "../../shared/cv.js";

const FONTS_DIR = join(import.meta.dirname, "fonts");

pdfmake.setFonts({
  NotoSans: {
    normal: join(FONTS_DIR, "NotoSans-Regular.ttf"),
    bold: join(FONTS_DIR, "NotoSans-Bold.ttf"),
    italics: join(FONTS_DIR, "NotoSans-Italic.ttf"),
    bolditalics: join(FONTS_DIR, "NotoSans-Bold.ttf"),
  },
});
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => path.startsWith(FONTS_DIR + "/"));

function present(values: (string | null)[]): string[] {
  return values.filter((v): v is string => v !== null && v.trim() !== "");
}

function dates(start: string | null, end: string | null): string {
  return present([start, end]).join(" – ");
}

function heading(text: string): Content {
  return { text, style: "h2" };
}

// Every array handed to pdfmake is built fresh here, because pdfmake mutates the definition in place.
export function cvToDocDefinition(cv: Cv): TDocumentDefinitions {
  const { contact } = cv;
  const content: Content[] = [];
  const name = present([contact.name])[0];
  if (name !== undefined) content.push({ text: name, style: "name" });
  const contactLine = present([contact.email, contact.phone, contact.location, ...contact.links]);
  if (contactLine.length > 0) content.push({ text: contactLine.join("  ·  "), margin: [0, 0, 0, 8] });

  if (cv.summary.trim() !== "") content.push(heading("Summary"), { text: cv.summary, margin: [0, 0, 0, 6] });

  if (cv.experience.length > 0) {
    content.push(heading("Experience"));
    for (const item of cv.experience) {
      const stack: Content[] = [];
      const titleLine = present([item.title, item.employer]).join(", ");
      if (titleLine !== "") stack.push({ text: titleLine, bold: true });
      const meta = present([dates(item.start, item.end), item.location]).join("  ·  ");
      if (meta !== "") stack.push({ text: meta, italics: true, color: "#555555" });
      const bullets = present(item.bullets);
      if (bullets.length > 0) stack.push({ ul: bullets, margin: [0, 2, 0, 0] });
      if (stack.length > 0) content.push({ stack, margin: [0, 0, 0, 8] });
    }
  }

  if (cv.education.length > 0) {
    content.push(heading("Education"));
    for (const item of cv.education) {
      const stack: Content[] = [];
      const titleLine = present([item.degree, item.institution]).join(", ");
      if (titleLine !== "") stack.push({ text: titleLine, bold: true });
      const meta = dates(item.start, item.end);
      if (meta !== "") stack.push({ text: meta, italics: true, color: "#555555" });
      if (stack.length > 0) content.push({ stack, margin: [0, 0, 0, 8] });
    }
  }

  const skills = present(cv.skills);
  if (skills.length > 0) content.push(heading("Skills"), { text: skills.join(", ") });

  return {
    pageSize: "A4",
    pageMargins: [48, 48, 48, 48],
    defaultStyle: { font: "NotoSans", fontSize: 10, lineHeight: 1.2 },
    styles: {
      name: { fontSize: 22, bold: true, margin: [0, 0, 0, 2] },
      h2: { fontSize: 12, bold: true, margin: [0, 8, 0, 4] },
    },
    content,
  };
}

export function renderCvPdf(cv: Cv): Promise<Buffer> {
  return pdfmake.createPdf(cvToDocDefinition(cv)).getBuffer();
}
