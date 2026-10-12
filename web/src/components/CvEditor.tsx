import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, type ComponentProps, type FormEvent } from "react";
import {
  CV_EDIT_BULLET_MAX,
  CV_EDIT_LIST_MAX,
  CV_EDIT_SHORT_MAX,
  CV_EDIT_SUMMARY_MAX,
  type CvDetail,
} from "../../../shared/api.js";
import type { Cv } from "../../../shared/cv.js";
import { api, ApiError } from "../api.js";

type Experience = Cv["experience"][number];
type Education = Cv["education"][number];

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function replaceAt<T>(items: T[], index: number, item: T): T[] {
  return items.map((existing, i) => (i === index ? item : existing));
}

function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}

export function CvEditor({ id, initial, onReload }: { id: string; initial: CvDetail & { content: Cv }; onReload: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Cv>(initial.content);
  const [saved, setSaved] = useState({ content: initial.content, version: initial.version });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.content);
  const save = useMutation({
    mutationFn: (content: Cv) => api.saveCv(id, { content, version: saved.version }),
    onSuccess: ({ version }, content) => {
      setSaved({ content, version });
      queryClient.setQueryData<CvDetail>(["cv", id], (old) => (old ? { ...old, content, version } : old));
      void queryClient.invalidateQueries({ queryKey: ["cvs"] });
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate(draft);
  }

  const { contact } = draft;
  const setContact = (patch: Partial<Cv["contact"]>) => setDraft({ ...draft, contact: { ...contact, ...patch } });

  return (
    <form className="editor" onSubmit={onSubmit}>
      <section className="card">
        <h2>Contact</h2>
        <div className="grid">
          <TextField label="Name" value={contact.name} onChange={(name) => setContact({ name })} />
          <TextField label="Email" type="email" value={contact.email} onChange={(email) => setContact({ email })} />
          <TextField label="Phone" type="tel" value={contact.phone} onChange={(phone) => setContact({ phone })} />
          <TextField label="Location" value={contact.location} onChange={(location) => setContact({ location })} />
        </div>
        <ListField
          label="Links"
          itemLabel="Link"
          addLabel="Add link"
          items={contact.links}
          maxLength={CV_EDIT_SHORT_MAX}
          onChange={(links) => setContact({ links })}
        />
      </section>

      <section className="card">
        <h2>Summary</h2>
        <label>
          <span className="sr-only">Summary</span>
          <GrowingTextarea
            maxLength={CV_EDIT_SUMMARY_MAX}
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          />
        </label>
      </section>

      <section className="card">
        <h2>Experience</h2>
        {draft.experience.map((item, index) => (
          <ExperienceFields
            key={item.id}
            item={item}
            onChange={(next) => setDraft({ ...draft, experience: replaceAt(draft.experience, index, next) })}
            onRemove={() => setDraft({ ...draft, experience: removeAt(draft.experience, index) })}
          />
        ))}
        <button
          type="button"
          className="secondary"
          disabled={draft.experience.length >= CV_EDIT_LIST_MAX}
          onClick={() =>
            setDraft({
              ...draft,
              experience: [
                ...draft.experience,
                { id: newId("exp"), title: null, employer: null, location: null, start: null, end: null, bullets: [] },
              ],
            })
          }
        >
          Add experience
        </button>
      </section>

      <section className="card">
        <h2>Education</h2>
        {draft.education.map((item, index) => (
          <EducationFields
            key={item.id}
            item={item}
            onChange={(next) => setDraft({ ...draft, education: replaceAt(draft.education, index, next) })}
            onRemove={() => setDraft({ ...draft, education: removeAt(draft.education, index) })}
          />
        ))}
        <button
          type="button"
          className="secondary"
          disabled={draft.education.length >= CV_EDIT_LIST_MAX}
          onClick={() =>
            setDraft({
              ...draft,
              education: [...draft.education, { id: newId("edu"), degree: null, institution: null, start: null, end: null }],
            })
          }
        >
          Add education
        </button>
      </section>

      <section className="card">
        <h2>Skills</h2>
        <ListField
          label="Skills"
          itemLabel="Skill"
          addLabel="Add skill"
          items={draft.skills}
          maxLength={CV_EDIT_SHORT_MAX}
          onChange={(skills) => setDraft({ ...draft, skills })}
        />
      </section>

      <div className="savebar">
        <div className="savebar-status" role="status">
          {save.isError ? (
            <span className="error">{save.error.message}</span>
          ) : dirty ? (
            <span className="muted">Unsaved changes. The PDF has the saved version.</span>
          ) : save.isSuccess ? (
            <span>Saved.</span>
          ) : null}
        </div>
        <div className="savebar-actions">
          {conflict && (
            <button type="button" className="secondary" onClick={onReload}>
              Reload
            </button>
          )}
          <a className="button secondary" href={api.pdfUrl(id)} download>
            Download PDF
          </a>
          <button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </form>
  );
}

function GrowingTextarea(props: ComponentProps<"textarea"> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [props.value]);
  return <textarea ref={ref} rows={1} {...props} />;
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  type?: "text" | "email" | "tel";
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        maxLength={CV_EDIT_SHORT_MAX}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      />
    </label>
  );
}

function ListField({
  label,
  itemLabel,
  addLabel,
  items,
  maxLength,
  multiline = false,
  onChange,
}: {
  label: string;
  itemLabel: string;
  addLabel: string;
  items: string[];
  maxLength: number;
  multiline?: boolean;
  onChange: (items: string[]) => void;
}) {
  return (
    <fieldset className="list-field">
      <legend>{label}</legend>
      {items.map((value, index) => {
        const name = `${itemLabel} ${index + 1}`;
        const set = (next: string) => onChange(replaceAt(items, index, next));
        return (
          <div key={index} className="list-item">
            {multiline ? (
              <GrowingTextarea aria-label={name} maxLength={maxLength} value={value} onChange={(e) => set(e.target.value)} />
            ) : (
              <input aria-label={name} maxLength={maxLength} value={value} onChange={(e) => set(e.target.value)} />
            )}
            <button type="button" className="remove" aria-label={`Remove ${name.toLowerCase()}`} onClick={() => onChange(removeAt(items, index))}>
              Remove
            </button>
          </div>
        );
      })}
      <button type="button" className="secondary" disabled={items.length >= CV_EDIT_LIST_MAX} onClick={() => onChange([...items, ""])}>
        {addLabel}
      </button>
    </fieldset>
  );
}

function ExperienceFields({
  item,
  onChange,
  onRemove,
}: {
  item: Experience;
  onChange: (item: Experience) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<Experience>) => onChange({ ...item, ...patch });
  return (
    <div className="entry-editor">
      <div className="grid">
        <TextField label="Title" value={item.title} onChange={(title) => set({ title })} />
        <TextField label="Employer" value={item.employer} onChange={(employer) => set({ employer })} />
        <TextField label="Location" value={item.location} onChange={(location) => set({ location })} />
        <TextField label="Start" value={item.start} onChange={(start) => set({ start })} />
        <TextField label="End" value={item.end} onChange={(end) => set({ end })} />
      </div>
      <ListField
        label="Bullets"
        itemLabel="Bullet"
        addLabel="Add bullet"
        items={item.bullets}
        maxLength={CV_EDIT_BULLET_MAX}
        multiline
        onChange={(bullets) => set({ bullets })}
      />
      <button type="button" className="remove" onClick={onRemove}>
        Remove this experience
      </button>
    </div>
  );
}

function EducationFields({
  item,
  onChange,
  onRemove,
}: {
  item: Education;
  onChange: (item: Education) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<Education>) => onChange({ ...item, ...patch });
  return (
    <div className="entry-editor">
      <div className="grid">
        <TextField label="Degree" value={item.degree} onChange={(degree) => set({ degree })} />
        <TextField label="Institution" value={item.institution} onChange={(institution) => set({ institution })} />
        <TextField label="Start" value={item.start} onChange={(start) => set({ start })} />
        <TextField label="End" value={item.end} onChange={(end) => set({ end })} />
      </div>
      <button type="button" className="remove" onClick={onRemove}>
        Remove this education
      </button>
    </div>
  );
}
