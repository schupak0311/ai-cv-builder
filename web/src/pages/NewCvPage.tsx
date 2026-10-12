import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { SOURCE_TEXT_MAX, SOURCE_TEXT_MIN, TARGET_ROLE_MAX, TARGET_ROLE_MIN } from "../../../shared/api.js";
import { api } from "../api.js";

export function NewCvPage() {
  const [targetRole, setTargetRole] = useState("");
  const [sourceText, setSourceText] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: api.createCv,
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ["cvs"] });
      void navigate(`/cvs/${id}`);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate({ targetRole, sourceText });
  }

  return (
    <>
      <h1>New CV</h1>
      <form onSubmit={onSubmit} className="form">
        <label>
          Target role
          <input
            required
            minLength={TARGET_ROLE_MIN}
            maxLength={TARGET_ROLE_MAX}
            placeholder="Senior Backend Engineer"
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
          />
        </label>
        <label>
          Your background
          <textarea
            required
            minLength={SOURCE_TEXT_MIN}
            maxLength={SOURCE_TEXT_MAX}
            rows={14}
            placeholder="Paste your current CV or describe your experience, education and skills."
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
          />
          <span className="muted">
            {sourceText.length.toLocaleString()} / {SOURCE_TEXT_MAX.toLocaleString()} characters
          </span>
        </label>
        {create.isError && <p className="error">{create.error.message}</p>}
        <button type="submit" disabled={create.isPending}>
          Write my CV
        </button>
      </form>
    </>
  );
}
