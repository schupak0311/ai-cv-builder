import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { describe, expect, test } from "vitest";
import { signUp, useTestApp } from "../../test/helpers.js";

const ctx = useTestApp();

const fixture = (name: string) => readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url));

async function upload(
  app: FastifyInstance,
  cookie: string,
  file: { bytes: Buffer; name: string; type?: string },
  targetRole = "Senior Data Engineer",
) {
  const form = new FormData();
  form.append("targetRole", targetRole);
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type ?? "application/pdf" }), file.name);
  const encoded = new Request("http://localhost/api/cvs", { method: "POST", body: form });
  return app.inject({
    method: "POST",
    url: "/api/cvs",
    headers: { cookie, "content-type": encoded.headers.get("content-type") ?? "" },
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
}

function buildPdf(pageLines: string[][]): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageLines.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pageLines.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [i, lines] of pageLines.entries()) {
    const stream = lines.length === 0 ? "" : `BT /F1 8 Tf 10 TL 20 820 Td ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
const LINE = "Built data pipelines for logistics and insurance companies over many years ";

describe("creating a CV from a PDF", () => {
  test("a PDF upload stores its text as the Source and queues a draft job", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "daniel@example.org");
    const bob = await signUp(app, "bob@example.com");

    const cases = [
      { file: "one-column-en.pdf", phrases: ["Daniel Okafor", "daniel.okafor@example.org", "Northwind Logistics"] },
      { file: "two-column-en.pdf", phrases: ["lena.fischer@example.net", "Berlin, Germany"] },
    ];
    for (const { file, phrases } of cases) {
      const res = await upload(app, cookie, { bytes: fixture(file), name: file });
      expect(res.statusCode).toBe(201);
      const { id } = res.json<{ id: string }>();

      const [cv] = await ctx.sql<{ sourceKind: string; sourceText: string }[]>`
        select source_kind, source_text from cvs where id = ${id}
      `;
      expect(cv?.sourceKind).toBe("pdf");
      for (const phrase of phrases) expect(cv?.sourceText).toContain(phrase);

      const own = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie } });
      expect(own.json()).toMatchObject({ id, targetRole: "Senior Data Engineer", job: { status: "queued" } });

      const other = await app.inject({ method: "GET", url: `/api/cvs/${id}`, headers: { cookie: bob } });
      expect(other.statusCode).toBe(404);
      expect(other.json()).toEqual({ error: "CV not found." });
    }
  });

  test("an upload that cannot become a Source creates no CV and no job", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "daniel@example.org");
    const valid = fixture("one-column-en.pdf");

    const cases = [
      { bytes: PNG, status: 422, error: "This file is not a PDF." },
      { bytes: buildPdf([[]]), status: 422, error: "This PDF has no selectable text. Paste your CV as text instead." },
      { bytes: valid.subarray(0, valid.length / 2), status: 422, error: "We could not read this PDF." },
      { bytes: buildPdf(Array.from({ length: 11 }, () => [LINE, LINE])), status: 422, error: "Your CV has more than 10 pages." },
      { bytes: buildPdf(Array.from({ length: 10 }, () => Array<string>(30).fill(LINE))), status: 422, error: "Keep your text under 20,000 characters." },
      { bytes: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024)]), status: 413, error: "The file is larger than 5 MB." },
    ];
    for (const { bytes, status, error } of cases) {
      const res = await upload(app, cookie, { bytes, name: "cv.pdf" });
      expect({ status: res.statusCode, body: res.json<unknown>() }).toEqual({ status, body: { error } });
    }
    expect(await ctx.sql`select 1 from cvs`).toHaveLength(0);
    expect(await ctx.sql`select 1 from jobs`).toHaveLength(0);
  });

  test("an upload still needs a Target role and a file", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "daniel@example.org");

    const noRole = await upload(app, cookie, { bytes: fixture("one-column-en.pdf"), name: "cv.pdf" }, "X");
    expect(noRole.statusCode).toBe(400);
    expect(noRole.json()).toEqual({ error: "Enter a target role of at least 2 characters." });

    const form = new FormData();
    form.append("targetRole", "Senior Data Engineer");
    const encoded = new Request("http://localhost/api/cvs", { method: "POST", body: form });
    const noFile = await app.inject({
      method: "POST",
      url: "/api/cvs",
      headers: { cookie, "content-type": encoded.headers.get("content-type") ?? "" },
      payload: Buffer.from(await encoded.arrayBuffer()),
    });
    expect(noFile.statusCode).toBe(400);
    expect(noFile.json()).toEqual({ error: "Choose a PDF file." });
    expect(await ctx.sql`select 1 from cvs`).toHaveLength(0);
  });
});
