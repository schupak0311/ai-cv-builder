import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  PDF_MAX_BYTES,
  SOURCE_TEXT_MAX,
  SOURCE_TEXT_MIN,
  TARGET_ROLE_MAX,
  TARGET_ROLE_MIN,
} from "../../../shared/api.js";
import { api } from "../api.js";

type SourceKind = "pdf" | "text";

type NewCv = { targetRole: string } & ({ kind: "pdf"; file: File } | { kind: "text"; sourceText: string });

function createCv(input: NewCv) {
  switch (input.kind) {
    case "pdf":
      if (input.file.size > PDF_MAX_BYTES) return Promise.reject(new Error("The file is larger than 5 MB."));
      return api.createCvFromPdf({ targetRole: input.targetRole, file: input.file });
    case "text":
      return api.createCv({ targetRole: input.targetRole, sourceText: input.sourceText });
    default: {
      const _exhaustive: never = input;
      return _exhaustive;
    }
  }
}

export function NewCvPage() {
  const [targetRole, setTargetRole] = useState("");
  const [kind, setKind] = useState<SourceKind>("pdf");
  const [sourceText, setSourceText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: createCv,
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: ["cvs"] });
      void navigate(`/cvs/${id}`);
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (kind === "text") create.mutate({ targetRole, kind, sourceText });
    else if (file !== null) create.mutate({ targetRole, kind, file });
  }

  function chooseKind(next: SourceKind) {
    setKind(next);
    create.reset();
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
        <fieldset className="choice">
          <legend>Your background</legend>
          <label>
            <input type="radio" name="kind" checked={kind === "pdf"} onChange={() => chooseKind("pdf")} />
            Upload a PDF
          </label>
          <label>
            <input type="radio" name="kind" checked={kind === "text"} onChange={() => chooseKind("text")} />
            Paste text
          </label>
        </fieldset>
        {kind === "pdf" ? (
          <label>
            Your current CV
            <input
              type="file"
              required
              accept="application/pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                create.reset();
              }}
            />
            <span className="muted">A PDF with selectable text, up to 5 MB and 10 pages.</span>
          </label>
        ) : (
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
        )}
        {create.isError && (
          <p className="error" role="alert">
            {create.error.message}
          </p>
        )}
        <button type="submit" disabled={create.isPending}>
          {create.isPending && kind === "pdf" ? "Reading your PDF…" : "Write my CV"}
        </button>
      </form>
    </>
  );
}
