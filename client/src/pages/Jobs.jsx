import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Empty, Loading, StatusBadge, formatDate } from "../components/ui.jsx";

export default function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Debounced so we do not fire a request on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .listJobs({ q: search, status })
        .then((result) => setJobs(result.jobs))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [search, status]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Vacancies</h1>
          <p className="subtitle">Every job we are recruiting for, and how many people applied.</p>
        </div>
        <Link className="btn btn-primary" to="/jobs/new">
          + New vacancy
        </Link>
      </div>

      <Alert kind="error">{error}</Alert>

      <div className="filters">
        <input
          className="input grow"
          placeholder="Search by title, department or location…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="select"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Open only</option>
          <option value="CLOSED">Closed only</option>
        </select>
      </div>

      {loading ? (
        <Loading what="vacancies" />
      ) : jobs.length === 0 ? (
        <div className="table-wrap">
          <Empty title="No vacancies found">
            <p>Try a different search, or create your first vacancy.</p>
            <Link className="btn btn-primary mt-2" to="/jobs/new">
              + New vacancy
            </Link>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job title</th>
                <th>Department</th>
                <th>Location</th>
                <th>Type</th>
                <th>Applicants</th>
                <th>Status</th>
                <th>Posted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <Link className="cell-title" to={"/jobs/" + job.id}>
                      {job.title}
                    </Link>
                    <div className="cell-sub">{job.stages?.length || 0} stage pipeline</div>
                  </td>
                  <td>{job.department || "—"}</td>
                  <td>{job.location || "—"}</td>
                  <td>{job.employmentType}</td>
                  <td>{job.applicantCount ?? 0}</td>
                  <td>
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="cell-sub">{formatDate(job.createdAt)}</td>
                  <td className="cell-right">
                    <Link className="btn btn-secondary btn-sm" to={"/jobs/" + job.id}>
                      Open
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
