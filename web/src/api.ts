import { z } from "zod";
import { CvDetail, CvSummary, Me, SavedCv } from "../../shared/api.js";
import type { Cv } from "../../shared/cv.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ErrorBody = z.object({ error: z.string() });

export async function request<T>(path: string, schema: z.ZodType<T>, init?: { method: string; body?: unknown }): Promise<T> {
  const body = init?.body;
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" },
    body: body === undefined ? null : body instanceof FormData ? body : JSON.stringify(body),
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
  createCvFromPdf: ({ targetRole, file }: { targetRole: string; file: File }) => {
    const body = new FormData();
    body.append("targetRole", targetRole);
    body.append("file", file);
    return request("/api/cvs", Created, { method: "POST", body });
  },
  saveCv: (id: string, body: { content: Cv; version: number }) =>
    request(`/api/cvs/${encodeURIComponent(id)}`, SavedCv, { method: "PUT", body }),
  pdfUrl: (id: string) => `/api/cvs/${encodeURIComponent(id)}/pdf`,
  deleteCv: (id: string) => request(`/api/cvs/${encodeURIComponent(id)}`, z.null(), { method: "DELETE" }),
};
