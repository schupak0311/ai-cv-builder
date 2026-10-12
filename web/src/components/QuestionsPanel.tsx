import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ANSWER_MAX, type CvDetail } from "../../../shared/api.js";
import { CvSection } from "../../../shared/cv.js";
import { questionsApi } from "../questionsApi.js";
import "./QuestionsPanel.css";

type Question = CvDetail["questions"][number];

const SECTION_LABELS: Record<CvSection, string> = {
  contact: "Contact",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
};

export const SAVE_FIRST = "Save or discard your edits before answering a question.";

export function QuestionsPanel({ cv, blocked }: { cv: CvDetail; blocked: boolean }) {
  if (cv.questions.length === 0) return null;
  const open = cv.questions.filter((q) => q.answer === null);
  const answered = cv.questions.filter((q) => q.answer !== null);

  return (
    <section className="questions" aria-labelledby="questions-title">
      <h2 id="questions-title">Questions</h2>
      {open.length > 0 && <p className="muted">{blocked ? SAVE_FIRST : "Answering a question rewrites that section of your CV."}</p>}
      {CvSection.options.map((section) => {
        const inSection = open.filter((q) => q.section === section);
        if (inSection.length === 0) return null;
        return (
          <div key={section} className="questions-group">
            <h3>{SECTION_LABELS[section]}</h3>
            {inSection.map((q) => (
              <AnswerForm key={q.id} cvId={cv.id} question={q} blocked={blocked} />
            ))}
          </div>
        );
      })}
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

function AnswerForm({ cvId, question, blocked }: { cvId: string; question: Question; blocked: boolean }) {
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState("");
  const submit = useMutation({
    mutationFn: () => questionsApi.answer({ cvId, questionId: question.id, answer }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cv", cvId] }),
  });
  const fieldId = `answer-${question.id}`;

  return (
    <form
      className="question"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <label htmlFor={fieldId}>{question.text}</label>
      <textarea
        id={fieldId}
        rows={2}
        maxLength={ANSWER_MAX}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
      />
      {submit.isError && (
        <p className="error" role="alert">
          {submit.error.message}
        </p>
      )}
      <button type="submit" disabled={blocked || submit.isPending || answer.trim().length === 0}>
        {submit.isPending ? "Sending…" : "Answer"}
      </button>
    </form>
  );
}
