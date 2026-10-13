import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ANSWER_MAX, type CvDetail } from "../../../shared/api.js";
import { CvSection } from "../../../shared/cv.js";
import { api } from "../api.js";

type Question = CvDetail["questions"][number];

const SECTION_LABELS: Record<CvSection, string> = {
  contact: "Contact",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
};

export function QuestionsPanel({
  cvId,
  questions,
  dirty,
  saveDraft,
  onSent,
}: {
  cvId: string;
  questions: Question[];
  dirty: boolean;
  saveDraft: () => Promise<void>;
  onSent: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: async (answers: { questionId: string; answer: string }[]) => {
      await saveDraft();
      await api.answers({ cvId, answers });
    },
    onSuccess: onSent,
  });
  if (questions.length === 0) return null;
  const open = questions.filter((q) => q.answer === null);
  const answered = questions.filter((q) => q.answer !== null);
  const filled = open
    .map((q) => ({ questionId: q.id, answer: (drafts[q.id] ?? "").trim() }))
    .filter((a) => a.answer.length > 0);

  return (
    <section className="questions" aria-labelledby="questions-title">
      <h2 id="questions-title">Questions</h2>
      {open.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate(filled);
          }}
        >
          <p className="muted">
            Answer any of these and send them together. Each answer rewrites only its section of your CV.
            {dirty && " Your unsaved edits are saved first."}
          </p>
          {CvSection.options.map((section) => {
            const inSection = open.filter((q) => q.section === section);
            if (inSection.length === 0) return null;
            return (
              <div key={section} className="questions-group">
                <h3>{SECTION_LABELS[section]}</h3>
                {inSection.map((q) => (
                  <div key={q.id} className="question">
                    <label htmlFor={`answer-${q.id}`}>{q.text}</label>
                    <textarea
                      id={`answer-${q.id}`}
                      rows={2}
                      maxLength={ANSWER_MAX}
                      value={drafts[q.id] ?? ""}
                      onChange={(event) => setDrafts({ ...drafts, [q.id]: event.target.value })}
                    />
                  </div>
                ))}
              </div>
            );
          })}
          <div className="question">
            {send.isError && (
              <p className="error" role="alert">
                {send.error.message}
              </p>
            )}
            <button type="submit" disabled={send.isPending || filled.length === 0}>
              {send.isPending ? "Sending…" : "Send answers"}
            </button>
          </div>
        </form>
      )}
      {answered.length > 0 && (
        <div className="questions-group">
          <h3>Answered</h3>
          <ul className="questions-answered">
            {answered.map((q) => (
              <li key={q.id}>
                <p className="muted">
                  {SECTION_LABELS[q.section]} · {q.text}
                </p>
                <p>{q.answer}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
