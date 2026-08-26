import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Empty, Loading, formatDateTime } from "../components/ui.jsx";

export default function Interviews() {
  const [interviews, setInterviews] = useState([]);
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .listInterviews(upcomingOnly ? { upcoming: 1 } : {})
      .then((result) => setInterviews(result.interviews))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [upcomingOnly]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Interviews</h1>
          <p className="subtitle">Every interview booked against a candidate, earliest first.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setUpcomingOnly((current) => !current)}>
          {upcomingOnly ? "Show past interviews too" : "Show upcoming only"}
        </button>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {loading ? (
        <Loading what="interviews" />
      ) : interviews.length === 0 ? (
        <div className="table-wrap">
          <Empty title="Nothing scheduled">
            <p>Open a candidate and use “Schedule interview” to book one.</p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Candidate</th>
                <th>Vacancy</th>
                <th>Stage</th>
                <th>Interviewer</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {interviews.map((interview) => (
                <tr key={interview.id}>
                  <td className="cell-title">{formatDateTime(interview.scheduledAt)}</td>
                  <td>
                    <Link to={"/candidates/" + interview.applicationId}>
                      {interview.candidateName}
                    </Link>
                  </td>
                  <td>{interview.jobTitle}</td>
                  <td>{interview.stage}</td>
                  <td>
                    {interview.interviewerName || "—"}
                    {interview.interviewerEmail && (
                      <div className="cell-sub">{interview.interviewerEmail}</div>
                    )}
                  </td>
                  <td className="cell-right">
                    <Link
                      className="btn btn-secondary btn-sm"
                      to={"/candidates/" + interview.applicationId}
                    >
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
