import { z } from "zod";

export const Me = z.object({ id: z.string(), email: z.string() });
export type Me = z.infer<typeof Me>;
