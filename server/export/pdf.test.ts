import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, test } from "vitest";
import type { Cv } from "../../shared/cv.js";
import { createCv, signUp, useTestApp } from "../../test/helpers.js";

const ctx = useTestApp();

const CONTENT: Cv = {
  contact: { name: "Zoë Ångström", email: "zoe@example.com", phone: null, location: "Malmö", links: [] },
  summary: "Backend engineer with eight years of experience building payment systems.",
  experience: [
    {
      id: "exp-1",
      employer: "Paylane",
      title: "Backend Engineer",
      location: null,
      start: "2019",
      end: "2024",
      bullets: ["Led the migration of the billing service to PostgreSQL."],
    },
  ],
  education: [],
  skills: ["TypeScript", "PostgreSQL"],
};

async function cvWith(cookie: string, content: Cv): Promise<string> {
  const id = await createCv(await ctx.app(), cookie);
  await ctx.sql`update cvs set content = ${ctx.sql.json(content)} where id = ${id}`;
  await ctx.sql`update jobs set status = 'done' where cv_id = ${id}`;
  return id;
}

async function parsePdf(data: Buffer): Promise<{ pages: string[]; text: string }> {
  const bytes = new Uint8Array(data);
  const pdf = await getDocumentProxy(bytes.slice());
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const [x0, y0, x1, y1] = (await pdf.getPage(i)).view;
    pages.push(`${(x1! - x0!).toFixed(2)}x${(y1! - y0!).toFixed(2)}`);
  }
  const { text } = await extractText(bytes.slice(), { mergePages: true });
  return { pages, text: text.replace(/\s+/g, " ") };
}

describe("PDF export", () => {
  test("an edited CV downloads as an A4 PDF with its text", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "zoe@example.com");
    const id = await cvWith(cookie, CONTENT);
    const edited: Cv = {
      ...CONTENT,
      experience: [
        {
          ...CONTENT.experience[0]!,
          bullets: ["Moved billing to PostgreSQL with zero downtime.", "Escaped <img onerror=alert(1)> in templates."],
        },
      ],
    };
    const put = await app.inject({
      method: "PUT",
      url: `/api/cvs/${id}`,
      headers: { cookie },
      payload: { content: edited, version: 1 },
    });
    expect(put.statusCode).toBe(200);

    const res = await app.inject({ method: "GET", url: `/api/cvs/${id}/pdf`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      `attachment; filename="Zo_ _ngstr_m CV.pdf"; filename*=UTF-8''Zo%C3%AB%20%C3%85ngstr%C3%B6m%20CV.pdf`,
    );
    const { pages, text } = await parsePdf(res.rawPayload);
    expect(pages).toEqual(["595.28x841.89"]);
    expect(text).toContain("Zoë Ångström");
    expect(text).toContain("Moved billing to PostgreSQL with zero downtime.");
    expect(text).toContain("Escaped <img onerror=alert(1)> in templates.");
    expect(text).not.toContain("Education");
  });

  test("a long CV runs onto a second A4 page", async () => {
    const app = await ctx.app();
    const cookie = await signUp(app, "zoe@example.com");
    const long: Cv = {
      ...CONTENT,
      experience: Array.from({ length: 8 }, (_, i) => ({
        ...CONTENT.experience[0]!,
        id: `exp-${i}`,
        employer: `Employer ${i}`,
        bullets: Array.from({ length: 5 }, (_, j) => `Bullet ${i}.${j} about shipping a reliable payment feature on time.`),
      })),
    };
    const id = await cvWith(cookie, long);

    const res = await app.inject({ method: "GET", url: `/api/cvs/${id}/pdf`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const { pages, text } = await parsePdf(res.rawPayload);
    expect(pages).toEqual(["595.28x841.89", "595.28x841.89"]);
    expect(text).toContain("Bullet 7.4 about shipping");
  });

  test("another user gets 404 and a CV without content gets 409", async () => {
    const app = await ctx.app();
    const anna = await signUp(app, "anna@example.com");
    const bob = await signUp(app, "bob@example.com");
    const drafted = await cvWith(anna, CONTENT);
    const empty = await createCv(app, anna);

    const foreign = await app.inject({ method: "GET", url: `/api/cvs/${drafted}/pdf`, headers: { cookie: bob } });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({ error: "CV not found." });

    const pending = await app.inject({ method: "GET", url: `/api/cvs/${empty}/pdf`, headers: { cookie: anna } });
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toEqual({ error: "This CV has no content yet." });
  });
});
