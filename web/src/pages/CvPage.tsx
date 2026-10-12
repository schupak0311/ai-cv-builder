import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { ActiveJob } from "../../../shared/api.js";
import { api } from "../api.js";
import { CvEditor } from "../components/CvEditor.js";
import { QuestionsPanel } from "../components/QuestionsPanel.js";
import { RetryJob } from "../components/RetryJob.js";

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
  const [loads, setLoads] = useState(0);
  const remove = useMutation({
    mutationFn: () => api.deleteCv(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["cvs"] });
      void navigate("/");
    },
  });

  if (cv.isPending) return <p>Loading…</p>;
  if (cv.isLoadingError) {
    return (
      <>
        <p className="error">{cv.error.message}</p>
        <button type="button" disabled={cv.isFetching} onClick={() => void cv.refetch()}>
          Try again
        </button>
      </>
    );
  }
  const detail = cv.data;
  const { targetRole, job, error, content } = detail;

  async function reload() {
    await cv.refetch();
    setLoads((n) => n + 1);
  }

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
      {job !== null && cv.isRefetchError && (
        <p className="error" role="alert">
          Lost contact with the server. Reconnecting…
        </p>
      )}
      {job === null && error !== null && (
        <div className="job-failed">
          <p className="error">{error}</p>
          <RetryJob cvId={id} />
        </div>
      )}
      {job === null && content !== null && (
        <>
          <QuestionsPanel cv={detail} />
          <CvEditor key={loads} id={id} initial={{ ...detail, content }} onReload={() => void reload()} />
        </>
      )}
    </>
  );
}

function JobProgress({ job }: { job: ActiveJob }) {
  const now = useNow(1000);
  const seconds = Math.max(0, Math.round((now - Date.parse(job.createdAt)) / 1000));
  return (
    <div className="progress" role="status">
      <p>
        <strong>{jobLabel(job)}</strong> · {seconds} s
      </p>
      <p className="muted">This can take a minute. You can leave this page and come back later.</p>
    </div>
  );
}

function jobLabel(job: ActiveJob): string {
  if (job.status === "queued") return "Waiting to start";
  return job.kind === "revise" ? "Updating your CV" : "Writing your CV";
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
