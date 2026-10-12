import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { ActiveJob } from "../../../shared/api.js";
import type { Cv } from "../../../shared/cv.js";
import { api } from "../api.js";

const POLL_MS = 2000;

export function CvPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const cv = useQuery({
    queryKey: ["cv", id],
    queryFn: () => api.getCv(id),
    refetchInterval: (query) => (query.state.data?.job ? POLL_MS : false),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCv(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cvs"] });
      void navigate("/");
    },
  });

  if (cv.isPending) return <p>Loading…</p>;
  if (cv.isError) return <p className="error">{cv.error.message}</p>;
  const { targetRole, job, error, content } = cv.data;

  return (
    <>
      <div className="row">
        <h1>{targetRole}</h1>
        <button
          type="button"
          className="link danger"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm("Delete this CV? This cannot be undone.")) remove.mutate();
          }}
        >
          Delete
        </button>
      </div>
      {job !== null && <JobProgress job={job} />}
      {job === null && error !== null && <p className="error">{error}</p>}
      {job === null && content !== null && <CvView cv={content} />}
    </>
  );
}

function JobProgress({ job }: { job: ActiveJob }) {
  const now = useNow(1000);
  const seconds = Math.max(0, Math.round((now - Date.parse(job.createdAt)) / 1000));
  return (
    <div className="progress" role="status">
      <p>
        <strong>{job.status === "queued" ? "Waiting to start" : "Writing your CV"}</strong> · {seconds} s
      </p>
      <p className="muted">This can take a minute. You can leave this page and come back later.</p>
    </div>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function dates(start: string | null, end: string | null): string {
  return [start, end].filter((d) => d !== null).join(" – ");
}

function CvView({ cv }: { cv: Cv }) {
  const { contact } = cv;
  const contactLine = [contact.email, contact.phone, contact.location, ...contact.links].filter((v) => v !== null);
  return (
    <article className="cv">
      {contact.name !== null && <h2>{contact.name}</h2>}
      {contactLine.length > 0 && <p className="muted">{contactLine.join(" · ")}</p>}
      {cv.summary !== "" && (
        <section>
          <h3>Summary</h3>
          <p>{cv.summary}</p>
        </section>
      )}
      {cv.experience.length > 0 && (
        <section>
          <h3>Experience</h3>
          {cv.experience.map((item) => (
            <div key={item.id} className="entry">
              <p>
                <strong>{[item.title, item.employer].filter((v) => v !== null).join(", ")}</strong>
              </p>
              <p className="muted">{[dates(item.start, item.end), item.location].filter((v) => v).join(" · ")}</p>
              <ul>
                {item.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      {cv.education.length > 0 && (
        <section>
          <h3>Education</h3>
          {cv.education.map((item) => (
            <div key={item.id} className="entry">
              <p>
                <strong>{[item.degree, item.institution].filter((v) => v !== null).join(", ")}</strong>
              </p>
              <p className="muted">{dates(item.start, item.end)}</p>
            </div>
          ))}
        </section>
      )}
      {cv.skills.length > 0 && (
        <section>
          <h3>Skills</h3>
          <p>{cv.skills.join(", ")}</p>
        </section>
      )}
    </article>
  );
}
