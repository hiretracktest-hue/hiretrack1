import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import {
  Alert,
  CvStatusBadge,
  Empty,
  Loading,
  OutcomeBadge,
  Stars,
} from "../components/ui.jsx";

/**
 * Scenario 1: "candidates can be compared fairly, side by side".
 * Everyone is scored out of 5 at each stage by whoever interviewed them,
 * so this table puts the same numbers next to each other instead of
 * comparing from memory.
 */
export default function Compare() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .compare(id)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Loading what="the comparison" />;
  if (!data) {
    return (
      <div className="page">
        <Alert kind="error">{error || "That vacancy could not be found."}</Alert>
        <Link className="btn btn-secondary" to="/jobs">
          Back to vacancies
        </Link>
      </div>
    );
  }

  const { job, stages, candidates } = data;
  const rated = candidates.filter((candidate) => candidate.feedbackCount > 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to={"/jobs/" + job.id}>
            ← {job.title}
          </Link>
          <h1 className="mt-1">Compare candidates</h1>
          <p className="subtitle">
            {candidates.length} candidate{candidates.length === 1 ? "" : "s"} for {job.title}, ranked
            by their average interview score.
          </p>
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {candidates.length === 0 ? (
        <div className="table-wrap">
          <Empty title="Nobody has applied yet">
            <p>Once people apply and interviewers leave feedback, they appear here side by side.</p>
          </Empty>
        </div>
      ) : (
        <>
          {rated.length === 0 && (
            <Alert kind="info">
              No interview feedback has been recorded yet. Open a candidate and use “Leave feedback”
              so this table can rank them.
            </Alert>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Overall</th>
                  {stages.map((stage) => (
                    <th key={stage}>{stage}</th>
                  ))}
                  <th>Recommendations</th>
                  <th>CV</th>
                  <th>Outcome</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td>
                      <Link className="cell-title" to={"/candidates/" + candidate.id}>
                        {candidate.fullName}
                      </Link>
                      <div className="cell-sub">
                        {candidate.currentStage} · {candidate.feedbackCount} review
                        {candidate.feedbackCount === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td>
                      <Stars value={candidate.averageRating} />
                    </td>
                    {stages.map((stage) => {
                      const entry = candidate.stageRatings[stage];
                      return (
                        <td key={stage}>
                          {entry ? (
                            <span title={entry.count + " review(s)"}>{entry.average} / 5</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="small">
                      <span style={{ color: "var(--green-fg)" }}>{candidate.votes.advance} ↑</span>{" "}
                      <span style={{ color: "var(--amber-fg)" }}>{candidate.votes.hold} =</span>{" "}
                      <span style={{ color: "var(--red-fg)" }}>{candidate.votes.reject} ↓</span>
                    </td>
                    <td>
                      <CvStatusBadge status={candidate.cvStatus} hasCv={candidate.hasCv} />
                    </td>
                    <td>
                      <OutcomeBadge outcome={candidate.outcome} />
                    </td>
                    <td className="cell-right">
                      <Link className="btn btn-secondary btn-sm" to={"/candidates/" + candidate.id}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="field-hint mt-2">
            Recommendations read as advance ↑ / hold = / reject ↓. Each interviewer can leave one
            score per stage, so nobody can weight the result by writing twice.
          </p>
        </>
      )}
    </div>
  );
}
