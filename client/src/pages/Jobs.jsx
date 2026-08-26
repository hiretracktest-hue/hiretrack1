import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Empty, Loading, StatusBadge, formatDate } from "../components/ui.jsx";

export default function Jobs() {
  const { user } = useAuth();
  const isStaff = Boolean(user?.isStaff);

  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState("");
  // A client is only ever shown vacancies that are still open.
  const [status, setStatus] = useState(isStaff ? "" : "ACTIVE");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Debounced so we do not fire a request on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .listJobs({ q: search, status: isStaff ? status : "ACTIVE" })
        .then((result) => setJobs(result.jobs))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [search, status, isStaff]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{isStaff ? "Vacancies" : "Open vacancies"}</h1>
          <p className="subtitle">
            {isStaff
              ? "Every job we are recruiting for, and how many people applied."
              : "Roles we are hiring for right now. Open one to apply and upload your CV."}
          </p>
        </div>
        {user?.permissions?.["vacancy:create"] && (
          <Link className="btn btn-primary" to="/jobs/new">
            + New vacancy
          </Link>
        )}
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      <div className="filters">
        <input
          className="input grow"
          placeholder="Search by title, department or location…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {isStaff && (
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
        )}
      </div>

      {loading ? (
        <Loading what="vacancies" />
      ) : jobs.length === 0 ? (
        <div className="table-wrap">
          <Empty title="No vacancies found">
            {isStaff ? (
              <>
                <p>Try a different search, or create your first vacancy.</p>
                {user?.permissions?.["vacancy:create"] && (
                  <Link className="btn btn-primary mt-2" to="/jobs/new">
                    + New vacancy
                  </Link>
                )}
              </>
            ) : (
              <p>There are no open vacancies at the moment. Please check back soon.</p>
            )}
          </Empty>
        </div>
      ) : isStaff ? (
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
      ) : (
        // Clients get job cards rather than a management table.
        <div className="grid grid-2">
          {jobs.map((job) => (
            <div className="card" key={job.id}>
              <div className="card-title">
                <div>
                  <h2>{job.title}</h2>
                  <div className="cell-sub">
                    {[job.department, job.location, job.employmentType]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <StatusBadge status={job.status} />
              </div>

              <p className="small muted">
                {job.description
                  ? job.description.slice(0, 180) + (job.description.length > 180 ? "…" : "")
                  : "No description was added for this role."}
              </p>

              {job.salaryRange && (
                <p className="small mt-2">
                  <strong>Salary:</strong> {job.salaryRange}
                </p>
              )}

              <Link className="btn btn-primary btn-block mt-3" to={"/jobs/" + job.id}>
                View and apply
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
