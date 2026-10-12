import { z } from "zod";

export const CvSection = z.enum(["contact", "summary", "experience", "education", "skills"]);
export type CvSection = z.infer<typeof CvSection>;

export const Cv = z.object({
  contact: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    links: z.array(z.string()),
  }),
  summary: z.string(),
  experience: z.array(
    z.object({
      id: z.string(),
      employer: z.string().nullable(),
      title: z.string().nullable(),
      location: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      bullets: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.object({
      id: z.string(),
      institution: z.string().nullable(),
      degree: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
    }),
  ),
  skills: z.array(z.string()),
});
export type Cv = z.infer<typeof Cv>;
