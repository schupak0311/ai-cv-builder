import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { JobStatus } from "../../../shared/api.js";
import { api } from "../api.js";

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Waiting to start",
  running: "Writing",
  done: "Ready",
  failed: "Failed",
};

export function CvListPage() {
  const cvs = useQuery({ queryKey: ["cvs"], queryFn: api.listCvs });

  return (
    <>
      <div className="row">
        <h1>Your CVs</h1>
        <Link to="/cvs/new" className="button">
          New CV
        </Link>
      </div>
      {cvs.isPending && <p>Loading…</p>}
      {cvs.isError && <p className="error">{cvs.error.message}</p>}
      {cvs.data?.length === 0 && <p>You have no CVs yet. Start one from your background and a target role.</p>}
      <ul className="cv-list">
        {cvs.data?.map((cv) => (
          <li key={cv.id}>
            <Link to={`/cvs/${cv.id}`}>{cv.targetRole}</Link>
            <span className="muted">
              {cv.status === null ? "" : STATUS_LABEL[cv.status]} · {new Date(cv.createdAt).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
