import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import {
  Alert,
  Empty,
  Loading,
  OUTCOME_LABEL,
  OutcomeBadge,
  formatDate,
} from "../components/ui.jsx";

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];

export default function Candidates() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [applications, setApplications] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [job, setJob] = useState(searchParams.get("job") || "");
  const [outcome, setOutcome] = useState(searchParams.get("outcome") || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listJobs()
      .then((result) => setJobs(result.jobs))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      // Keep the filters in the address bar so the view can be shared.
      setSearchParams(
        Object.fromEntries(
          Object.entries({ q: search, job, outcome }).filter(([, value]) => value)
        ),
        { replace: true }
      );

      api
        .listApplications({ q: search, job, outcome })
        .then((result) => setApplications(result.applications))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [search, job, outcome, setSearchParams]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Candidates</h1>
          <p className="subtitle">
            Everyone who has applied, across every vacancy. {applications.length} shown.
          </p>
        </div>
        <Link className="btn btn-primary" to="/jobs">
          Apply to a vacancy
        </Link>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      <div className="filters">
        <input
          className="input grow"
          placeholder="Search by name or email…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="select"
          value={job}
          onChange={(event) => setJob(event.target.value)}
          aria-label="Filter by vacancy"
        >
          <option value="">All vacancies</option>
          {jobs.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          aria-label="Filter by outcome"
        >
          <option value="">All outcomes</option>
          {OUTCOMES.map((value) => (
            <option key={value} value={value}>
              {OUTCOME_LABEL[value]}
            </option>
          ))}
        </select>
        {(search || job || outcome) && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSearch("");
              setJob("");
              setOutcome("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <Loading what="candidates" />
      ) : applications.length === 0 ? (
        <div className="table-wrap">
          <Empty title="No candidates match those filters">
            <p>Try clearing the search, or apply to a vacancy to create the first candidate.</p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Vacancy</th>
                <th>Stage</th>
                <th>Outcome</th>
                <th>CV</th>
                <th>Applied</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {applications.map((application) => (
                <tr key={application.id}>
                  <td>
                    <Link className="cell-title" to={"/candidates/" + application.id}>
                      {application.fullName}
                    </Link>
                    <div className="cell-sub">{application.email}</div>
                  </td>
                  <td>
                    <Link to={"/jobs/" + application.jobId}>{application.jobTitle}</Link>
                    <div className="cell-sub">{application.jobDepartment || "—"}</div>
                  </td>
                  <td>{application.currentStage}</td>
                  <td>
                    <OutcomeBadge outcome={application.outcome} />
                  </td>
                  <td>
                    {application.cv ? (
                      <a href={api.cvDownloadUrl(application.id)}>Download</a>
                    ) : (
                      <span className="muted small">None</span>
                    )}
                  </td>
                  <td className="cell-sub">{formatDate(application.createdAt)}</td>
                  <td className="cell-right">
                    <Link className="btn btn-secondary btn-sm" to={"/candidates/" + application.id}>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
