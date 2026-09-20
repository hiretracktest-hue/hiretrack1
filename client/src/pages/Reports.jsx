import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Empty, Loading, Stars, Stat, formatDate } from "../components/ui.jsx";
import { PipelineChart, ScreeningChart, InterviewerChart } from "../components/charts.jsx";

/**
 * "What reports would management want to export?"
 *
 * Oversight without edit rights: how the pipeline is filling, where
 * candidates are sitting, whether interviewers are keeping up, and how
 * long a decision takes. Every table downloads as CSV.
 */
export default function Reports() {
  const { user } = useAuth();
  const canExport = Boolean(user?.permissions?.["report:export"]);

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .reports()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading what="the reports" />;
  if (!data) {
    return (
      <div className="page">
        <Alert kind="error">{error || "The reports could not be loaded."}</Alert>
      </div>
    );
  }

  const { summary, vacancies, byStage, byBand, interviewerActivity } = data;

  // RPT-02. CSV for somebody who will carry on working with the numbers,
  // PDF for somebody who will only read them - a leadership meeting, an
  // email attachment - where a spreadsheet that opens differently on
  // every machine is worse than a page that looks the same everywhere.
  const ExportButton = ({ report, label }) =>
    canExport ? (
      <span className="btn-row">
        <a className="btn btn-secondary btn-sm" href={api.reportCsvUrl(report)}>
          CSV
        </a>
        <a className="btn btn-secondary btn-sm" href={api.reportPdfUrl(report)}>
          PDF
        </a>
      </span>
    ) : (
      <span className="muted small">{label}</span>
    );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="subtitle">
            A live view of recruitment across every vacancy. {canExport
              ? "Each table downloads as CSV to work with, or PDF to send on."
              : "Ask HR or management if you need an export."}
          </p>
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      <div className="grid grid-4">
        <Stat label="Vacancies" value={summary.openVacancies} />
        <Stat label="Candidates" value={summary.totalCandidates} />
        <Stat label="In progress" value={summary.activeCandidates} />
        <Stat label="Hired" value={summary.hired} />
      </div>

      <div className="grid grid-4 mt-2">
        <Stat label="CVs to screen" value={summary.awaitingScreening} />
        <Stat label="Upcoming interviews" value={summary.upcomingInterviews} />
        <Stat label="Feedback submitted" value={summary.feedbackSubmitted} />
        <Stat
          label="Avg days to decision"
          value={summary.averageDaysToDecision ?? "—"}
        />
      </div>

      {/* ---- per vacancy ---- */}
      <div className="card mt-3">
        <div className="card-title">
          <h2>By vacancy</h2>
          <ExportButton report="vacancies" label="" />
        </div>

        {vacancies.length === 0 ? (
          <Empty title="No vacancies yet" />
        ) : (
          <div className="table-wrap" style={{ border: "none", boxShadow: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Vacancy</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Candidates</th>
                  <th>In progress</th>
                  <th>On hold</th>
                  <th>Hired</th>
                  <th>Rejected</th>
                  <th>High band</th>
                  <th>Avg score</th>
                </tr>
              </thead>
              <tbody>
                {vacancies.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link className="cell-title" to={"/vacancies/" + row.id}>
                        {row.title}
                      </Link>
                      <div className="cell-sub">Opened {formatDate(row.openedOn)}</div>
                    </td>
                    <td>{row.department || "—"}</td>
                    <td>
                      <span className={"badge " + (row.status === "ACTIVE" ? "badge-green" : "badge-grey")}>
                        {row.status === "ACTIVE" ? "Open" : "Closed"}
                      </span>
                    </td>
                    <td>{row.candidates}</td>
                    <td>{row.active}</td>
                    <td>{row.onHold}</td>
                    <td>{row.hired}</td>
                    <td>{row.rejected}</td>
                    <td>{row.highBand}</td>
                    <td>
                      <Stars value={row.averageRating} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RPT-01. The picture first: the shape of the pipeline is the
          thing management is actually asking about. The tables below
          stay, because a chart is not a substitute for the numbers. */}
      <div className="grid grid-2 mt-2">
        <PipelineChart byStage={byStage} />
        <div>
          <ScreeningChart byBand={byBand} />
          <InterviewerChart interviewerActivity={interviewerActivity} />
        </div>
      </div>

      <div className="grid grid-2 mt-2">
        {/* ---- where candidates are sitting ---- */}
        <div className="card">
          <div className="card-title">
            <h2>Pipeline by stage</h2>
            <ExportButton report="stages" label="" />
          </div>
          <p className="field-hint">
            Where candidates who are still in the running are sitting right now. A stage that keeps
            growing is where people are getting stuck.
          </p>

          {byStage.length === 0 ? (
            <Empty title="Nobody in the pipeline yet" />
          ) : (
            <ul className="list mt-2">
              {byStage.map((row) => (
                <li key={row.jobTitle + row.stage}>
                  <div>
                    <div className="cell-title">{row.stage}</div>
                    <div className="cell-sub">{row.jobTitle}</div>
                  </div>
                  <span className="badge">{row.total}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---- screening progress ---- */}
        <div className="card">
          <h2>CV screening</h2>
          <p className="field-hint">
            How far through the pile of CVs the team is. "Not screened" is the backlog.
          </p>
          <ul className="list mt-2">
            {byBand.map((row) => (
              <li key={row.band}>
                <div className="cell-title">
                  {row.band === "UNRATED" ? "Not screened" : row.band.charAt(0) + row.band.slice(1).toLowerCase()}
                </div>
                <span className="badge">{row.total}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ---- interviewer activity ---- */}
      <div className="card mt-2">
        <div className="card-title">
          <h2>Interviewer activity</h2>
          <ExportButton report="interviewers" label="" />
        </div>
        <p className="field-hint">
          Feedback that has not been written blocks the candidate from moving on, so "outstanding"
          is the number to chase.
        </p>

        {interviewerActivity.length === 0 ? (
          <Empty title="No interviews booked yet" />
        ) : (
          <div className="table-wrap mt-2" style={{ border: "none", boxShadow: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Interviews</th>
                  <th>Feedback given</th>
                  <th>Outstanding</th>
                  <th>Average score</th>
                </tr>
              </thead>
              <tbody>
                {interviewerActivity.map((row) => (
                  <tr key={row.name}>
                    <td className="cell-title">{row.name}</td>
                    <td className="cell-sub">{row.role}</td>
                    <td>{row.interviews}</td>
                    <td>{row.feedback}</td>
                    <td>
                      {row.outstanding > 0 ? (
                        <span className="badge badge-amber">{row.outstanding}</span>
                      ) : (
                        <span className="badge badge-green">0</span>
                      )}
                    </td>
                    <td>
                      <Stars value={row.averageScore} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canExport && (
        <div className="card mt-2">
          <h2>Full candidate export</h2>
          <p className="field-hint">
            Every candidate across every vacancy, with their stage, outcome, CV band and average
            interview score.
          </p>
          <a className="btn btn-primary mt-2" href={api.reportCsvUrl("candidates")}>
            Download candidates CSV
          </a>
        </div>
      )}
    </div>
  );
}
