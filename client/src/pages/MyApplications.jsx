import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  Empty,
  Loading,
  OutcomeBadge,
  Pipeline,
  formatDate,
} from "../components/ui.jsx";

/** The applicant's own view: the jobs I applied for and my CV. */
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
            Applications submitted from your account ({user?.email}). Open one to upload or replace
            your CV.
          </p>
        </div>
        <Link className="btn btn-primary" to="/jobs">
          Browse vacancies
        </Link>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {applications.length === 0 ? (
        <div className="card">
          <Empty title="You have not applied to anything yet">
            <p>Open a vacancy and use “Apply / add candidate” to submit an application.</p>
            <Link className="btn btn-primary mt-2" to="/jobs">
              Browse vacancies
            </Link>
          </Empty>
        </div>
      ) : (
        <div className="grid grid-2">
          {applications.map((application) => (
            <div className="card" key={application.id}>
              <div className="card-title">
                <div>
                  <Link className="cell-title" to={"/jobs/" + application.jobId}>
                    {application.jobTitle}
                  </Link>
                  <div className="cell-sub">
                    Applied {formatDate(application.createdAt)} · as {application.fullName}
                  </div>
                </div>
                <OutcomeBadge outcome={application.outcome} />
              </div>

              <Pipeline stages={[application.currentStage]} currentStage={application.currentStage} />

              <div className="row-between mt-3">
                <span className="small muted">
                  {application.cv ? "CV: " + application.cv.filename : "No CV uploaded yet"}
                </span>
                <Link className="btn btn-secondary btn-sm" to={"/candidates/" + application.id}>
                  {application.cv ? "Update CV" : "Upload CV"}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
