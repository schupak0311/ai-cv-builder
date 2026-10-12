import { z } from "zod";
import { request } from "./api.js";

const path = (cvId: string) => `/api/cvs/${encodeURIComponent(cvId)}`;

export const questionsApi = {
  answer: ({ cvId, questionId, answer }: { cvId: string; questionId: string; answer: string }) =>
    request(`${path(cvId)}/questions/${encodeURIComponent(questionId)}/answer`, z.null(), {
      method: "POST",
      body: { answer },
    }),
  retry: (cvId: string) => request(`${path(cvId)}/retry`, z.null(), { method: "POST" }),
};
