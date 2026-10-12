import { z } from "zod";
import { CvDetail, CvSummary, Me } from "../../shared/api.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ErrorBody = z.object({ error: z.string() });

async function request<T>(path: string, schema: z.ZodType<T>, init?: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? {} : { "content-type": "application/json" },
    body: init?.body === undefined ? null : JSON.stringify(init.body),
  });
  const json: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ErrorBody.safeParse(json);
    throw new ApiError(res.status, parsed.success ? parsed.data.error : "Something went wrong. Try again.");
  }
  return schema.parse(json);
}

const Created = z.object({ id: z.string() });

export const api = {
  me: async (): Promise<Me | null> => {
    try {
      return await request("/api/me", Me);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  },
  signUp: (body: { email: string; password: string }) => request("/api/auth/signup", Me, { method: "POST", body }),
  logIn: (body: { email: string; password: string }) => request("/api/auth/login", Me, { method: "POST", body }),
  logOut: () => request("/api/auth/logout", z.null(), { method: "POST" }),
  listCvs: () => request("/api/cvs", z.array(CvSummary)),
  getCv: (id: string) => request(`/api/cvs/${encodeURIComponent(id)}`, CvDetail),
  createCv: (body: { targetRole: string; sourceText: string }) =>
    request("/api/cvs", Created, { method: "POST", body }),
  deleteCv: (id: string) => request(`/api/cvs/${encodeURIComponent(id)}`, z.null(), { method: "DELETE" }),
};
