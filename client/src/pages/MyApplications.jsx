import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  ClientStatusBadge,
  Empty,
  Loading,
  formatDate,
} from "../components/ui.jsx";

/**
 * A client's home page: the jobs they applied for and, for each one,
 * whether their CV is still being reviewed, was accepted, or was not
 * successful.
 */
export default function MyApplications() {
  const { user } = useAuth();
  const [applications, setApplications] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listApplications({ mine: 1 })
      .then((result) => setApplications(result.applications))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading what="your applications" />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My applications</h1>
          <p className="subtitle">
            Everything you have applied for with {user?.email}. Open one to upload or replace your
            CV and see where it stands.
          </p>
        </div>
        <Link className="btn btn-primary" to="/jobs">
          Browse open vacancies
        </Link>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {applications.length === 0 ? (
        <div className="card">
          <Empty title="You have not applied for anything yet">
            <p>Open a vacancy and press “Apply for this job” to send your first application.</p>
            <Link className="btn btn-primary mt-2" to="/jobs">
              Browse open vacancies
            </Link>
          </Empty>
        </div>
      ) : (
        <div className="grid grid-2">
          {applications.map((application) => (
            <div className="card" key={application.id}>
              <div className="card-title">
                <div>
                  <h2>{application.jobTitle}</h2>
                  <div className="cell-sub">
                    {[application.jobDepartment, application.jobLocation]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </div>
                <ClientStatusBadge status={application.clientStatus} />
              </div>

              <p className="small muted">{application.clientStatus?.detail}</p>

              <div className="detail-grid mt-3">
                <div>
                  <div className="detail-label">Applied on</div>
                  <div className="detail-value small">{formatDate(application.createdAt)}</div>
                </div>
                <div>
                  <div className="detail-label">Your CV</div>
                  <div className="detail-value small">
                    {application.cv ? application.cv.filename : "Not uploaded yet"}
                  </div>
                </div>
              </div>

              <Link
                className="btn btn-secondary btn-block mt-3"
                to={"/my-applications/" + application.id}
              >
                {application.cv ? "View / update my CV" : "Upload my CV"}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
