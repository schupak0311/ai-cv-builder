import { z } from "zod";

export const CvSection = z.enum(["contact", "summary", "experience", "education", "skills"]);
export type CvSection = z.infer<typeof CvSection>;

export const CV_EDIT_SHORT_MAX = 200;
export const CV_EDIT_SUMMARY_MAX = 3_000;
export const CV_EDIT_BULLET_MAX = 1_000;
export const CV_EDIT_LIST_MAX = 50;

const shortText = z.string().max(CV_EDIT_SHORT_MAX, `Keep each short field under ${CV_EDIT_SHORT_MAX} characters.`);
const nullableShort = shortText.nullable();
function list<T extends z.ZodType>(item: T) {
  return z.array(item).max(CV_EDIT_LIST_MAX, `Keep each list under ${CV_EDIT_LIST_MAX} items.`);
}

export const Cv = z.object({
  contact: z.object({
    name: nullableShort,
    email: nullableShort,
    phone: nullableShort,
    location: nullableShort,
    links: list(shortText),
  }),
  summary: z
    .string()
    .max(CV_EDIT_SUMMARY_MAX, `Keep the summary under ${CV_EDIT_SUMMARY_MAX.toLocaleString("en-US")} characters.`),
  experience: list(
    z.object({
      id: shortText,
      employer: nullableShort,
      title: nullableShort,
      location: nullableShort,
      start: nullableShort,
      end: nullableShort,
      bullets: list(
        z.string().max(CV_EDIT_BULLET_MAX, `Keep each bullet under ${CV_EDIT_BULLET_MAX.toLocaleString("en-US")} characters.`),
      ),
    }),
  ),
  education: list(
    z.object({
      id: shortText,
      institution: nullableShort,
      degree: nullableShort,
      start: nullableShort,
      end: nullableShort,
    }),
  ),
  skills: list(shortText),
});
export type Cv = z.infer<typeof Cv>;
