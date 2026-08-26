import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import {
  Alert,
  CvStatusBadge,
  Field,
  Loading,
  OUTCOME_LABEL,
  OutcomeBadge,
  Pipeline,
  RecommendationBadge,
  Stars,
  formatBytes,
  formatDate,
  formatDateTime,
} from "../components/ui.jsx";
import { useAuth } from "../AuthContext.jsx";

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];
const RECOMMENDATIONS = ["ADVANCE", "HOLD", "REJECT"];

export default function CandidateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { user } = useAuth();
  const [application, setApplication] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [outcome, setOutcome] = useState("ACTIVE");
  const [cvFile, setCvFile] = useState(null);
  const [interviewForm, setInterviewForm] = useState({
    stage: "",
    scheduledAt: "",
    interviewerName: "",
    interviewerEmail: "",
    notes: "",
  });
  const [feedbackForm, setFeedbackForm] = useState({
    stage: "",
    rating: 4,
    recommendation: "ADVANCE",
    strengths: "",
    concerns: "",
    comment: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getApplication(id);
      setApplication(result.application);
      setInterviews(result.interviews);
      setFeedback(result.feedback || []);
      setOutcome(result.application.outcome);
      setEditForm({
        fullName: result.application.fullName,
        email: result.application.email,
        phone: result.application.phone || "",
        source: result.application.source || "",
        coverNote: result.application.coverNote || "",
        notes: result.application.notes || "",
      });
      setInterviewForm((current) => ({
        ...current,
        stage: current.stage || result.application.currentStage,
      }));
      setFeedbackForm((current) => ({
        ...current,
        stage: current.stage || result.application.currentStage,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Every action refreshes from the server response, so what is on
  // screen always matches what is in the database.
  async function run(action, successMessage) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (result?.application) {
        setApplication((current) => ({ ...current, ...result.application }));
      }
      if (successMessage) setMessage(successMessage);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    const result = await run(() => api.advanceApplication(id), null);
    if (result) {
      setMessage("Moved to " + result.application.currentStage + ".");
      await load();
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    const result = await run(() => api.updateApplication(id, editForm), "Candidate details saved.");
    if (result) setEditing(false);
  }

  async function saveOutcome() {
    await run(
      () => api.updateApplication(id, { outcome }),
      "Outcome recorded as " + OUTCOME_LABEL[outcome] + "."
    );
  }

  async function reviewCv(status) {
    await run(
      () => api.reviewCv(id, status),
      status === "ACCEPTED"
        ? "CV accepted - the candidate can see this on their own page."
        : "CV rejected - the candidate has been marked as not successful."
    );
  }

  async function submitFeedback(event) {
    event.preventDefault();
    const result = await run(
      () =>
        api.leaveFeedback({
          applicationId: Number(id),
          ...feedbackForm,
          rating: Number(feedbackForm.rating),
        }),
      "Your feedback was saved."
    );
    if (result?.feedback) {
      // One entry per person per stage: replace mine if it is already there.
      setFeedback((current) => [
        result.feedback,
        ...current.filter((item) => item.id !== result.feedback.id),
      ]);
      setFeedbackForm((current) => ({ ...current, strengths: "", concerns: "", comment: "" }));
    }
  }

  async function removeFeedback(feedbackId) {
    if (!window.confirm("Delete your feedback?")) return;
    const result = await run(() => api.deleteFeedback(feedbackId), "Feedback deleted.");
    if (result) setFeedback((current) => current.filter((item) => item.id !== feedbackId));
  }

  async function uploadCv(event) {
    event.preventDefault();
    if (!cvFile) return;
    const result = await run(() => api.uploadCv(id, cvFile), "CV uploaded.");
    if (result) {
      setCvFile(null);
      event.target.reset();
    }
  }

  async function removeCv() {
    if (!window.confirm("Remove this CV?")) return;
    await run(() => api.deleteCv(id), "CV removed.");
  }

  async function scheduleInterview(event) {
    event.preventDefault();
    const result = await run(
      () => api.scheduleInterview({ applicationId: Number(id), ...interviewForm }),
      "Interview scheduled."
    );
    if (result?.interview) {
      setInterviews((current) =>
        [...current, result.interview].sort(
          (a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)
        )
      );
      setInterviewForm((current) => ({
        ...current,
        scheduledAt: "",
        interviewerName: "",
        interviewerEmail: "",
        notes: "",
      }));
    }
  }

  async function cancelInterview(interviewId) {
    if (!window.confirm("Cancel this interview?")) return;
    const result = await run(() => api.cancelInterview(interviewId), "Interview cancelled.");
    if (result) {
      setInterviews((current) => current.filter((interview) => interview.id !== interviewId));
    }
  }

  async function withdraw() {
    if (!window.confirm("Delete this application and its CV? This cannot be undone.")) return;
    const result = await run(() => api.deleteApplication(id), null);
    if (result) navigate("/candidates", { replace: true });
  }

  function updateEdit(key) {
    return (event) => setEditForm((current) => ({ ...current, [key]: event.target.value }));
  }
  function updateInterview(key) {
    return (event) => setInterviewForm((current) => ({ ...current, [key]: event.target.value }));
  }
  function updateFeedback(key) {
    return (event) => setFeedbackForm((current) => ({ ...current, [key]: event.target.value }));
  }

  if (loading) return <Loading what="this candidate" />;
  if (!application) {
    return (
      <div className="page">
        <Alert kind="error">{error || "That candidate could not be found."}</Alert>
        <Link className="btn btn-secondary" to="/candidates">
          Back to candidates
        </Link>
      </div>
    );
  }

  const stages = application.stages || [];
  const averageRating = feedback.length
    ? Math.round((feedback.reduce((sum, item) => sum + item.rating, 0) / feedback.length) * 10) / 10
    : null;
  const stageIndex = stages.indexOf(application.currentStage);
  const nextStage = stageIndex >= 0 && stageIndex < stages.length - 1 ? stages[stageIndex + 1] : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to="/candidates">
            ← All candidates
          </Link>
          <h1 className="mt-1">{application.fullName}</h1>
          <p className="subtitle">
            Applied for <Link to={"/jobs/" + application.jobId}>{application.jobTitle}</Link> on{" "}
            {formatDate(application.createdAt)}
          </p>
        </div>
        <div className="btn-row">
          <OutcomeBadge outcome={application.outcome} />
          <button className="btn btn-secondary" onClick={() => setEditing((current) => !current)}>
            {editing ? "Cancel edit" : "Edit details"}
          </button>
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>
      <Alert kind="success" onDismiss={() => setMessage("")}>
        {message}
      </Alert>

      <div className="card">
        <div className="card-title">
          <h2>Progress</h2>
          <span className="muted small">
            Stage {stageIndex + 1} of {stages.length}
          </span>
        </div>

        <Pipeline stages={stages} currentStage={application.currentStage} />

        <div className="btn-row mt-3">
          <button className="btn btn-primary" onClick={advance} disabled={busy || !nextStage}>
            {nextStage ? "Move to " + nextStage : "Final stage reached"}
          </button>

          <select
            className="select"
            style={{ width: "auto" }}
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            aria-label="Outcome"
          >
            {OUTCOMES.map((value) => (
              <option key={value} value={value}>
                {OUTCOME_LABEL[value]}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            onClick={saveOutcome}
            disabled={busy || outcome === application.outcome}
          >
            Record outcome
          </button>
        </div>
        <p className="field-hint">
          The outcome is tracked separately from the stage, so a candidate can be at “
          {application.currentStage}” and on hold at the same time.
        </p>
      </div>

      <div className="grid grid-sidebar mt-2">
        <div>
          <div className="card">
            <h2>Candidate details</h2>

            {editing ? (
              <form onSubmit={saveEdit} className="mt-2">
                <div className="grid grid-2">
                  <Field label="Full name" htmlFor="fullName">
                    <input
                      id="fullName"
                      className="input"
                      required
                      value={editForm.fullName}
                      onChange={updateEdit("fullName")}
                    />
                  </Field>
                  <Field label="Email" htmlFor="email">
                    <input
                      id="email"
                      className="input"
                      type="email"
                      required
                      value={editForm.email}
                      onChange={updateEdit("email")}
                    />
                  </Field>
                  <Field label="Phone" htmlFor="phone">
                    <input
                      id="phone"
                      className="input"
                      value={editForm.phone}
                      onChange={updateEdit("phone")}
                    />
                  </Field>
                  <Field label="Source" htmlFor="source">
                    <input
                      id="source"
                      className="input"
                      value={editForm.source}
                      onChange={updateEdit("source")}
                    />
                  </Field>
                </div>

                <Field label="Cover note" htmlFor="coverNote">
                  <textarea
                    id="coverNote"
                    className="textarea"
                    rows={3}
                    value={editForm.coverNote}
                    onChange={updateEdit("coverNote")}
                  />
                </Field>

                <Field label="Internal notes" htmlFor="notes" hint="Only the hiring team sees this.">
                  <textarea
                    id="notes"
                    className="textarea"
                    rows={3}
                    value={editForm.notes}
                    onChange={updateEdit("notes")}
                  />
                </Field>

                <div className="btn-row">
                  <button className="btn btn-primary" disabled={busy}>
                    {busy ? "Saving…" : "Save changes"}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="detail-grid mt-2">
                  <div>
                    <div className="detail-label">Email</div>
                    <div className="detail-value">{application.email}</div>
                  </div>
                  <div>
                    <div className="detail-label">Phone</div>
                    <div className="detail-value">{application.phone || "—"}</div>
                  </div>
                  <div>
                    <div className="detail-label">Source</div>
                    <div className="detail-value">{application.source || "—"}</div>
                  </div>
                  <div>
                    <div className="detail-label">Submitted by</div>
                    <div className="detail-value">{application.appliedByName || "—"}</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="detail-label">Cover note</div>
                  <p className="detail-value" style={{ whiteSpace: "pre-wrap" }}>
                    {application.coverNote || "—"}
                  </p>
                </div>

                <div className="mt-3">
                  <div className="detail-label">Internal notes</div>
                  <p className="detail-value" style={{ whiteSpace: "pre-wrap" }}>
                    {application.notes || "—"}
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Interview feedback</h2>
              <span className="muted small">
                {feedback.length} review{feedback.length === 1 ? "" : "s"}
                {averageRating !== null ? " · average " + averageRating + " / 5" : ""}
              </span>
            </div>

            {feedback.length > 0 && (
              <div className="mb-2">
                {feedback.map((item) => (
                  <div className="feedback-item" key={item.id}>
                    <div className="row-between">
                      <div>
                        <strong>{item.authorName || "Unknown"}</strong>{" "}
                        <span className="small muted">· {item.stage}</span>
                      </div>
                      <div className="btn-row">
                        <Stars value={item.rating} />
                        <RecommendationBadge value={item.recommendation} />
                      </div>
                    </div>

                    {item.strengths && (
                      <p className="small mt-1">
                        <strong>Strengths:</strong> {item.strengths}
                      </p>
                    )}
                    {item.concerns && (
                      <p className="small">
                        <strong>Concerns:</strong> {item.concerns}
                      </p>
                    )}
                    {item.comment && <p className="small mt-1">{item.comment}</p>}

                    <div className="row-between mt-1">
                      <span className="cell-sub">{formatDateTime(item.createdAt)}</span>
                      {item.authorId === user?.id && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeFeedback(item.id)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={submitFeedback}>
              <div className="grid grid-3">
                <Field label="Stage" htmlFor="feedbackStage">
                  <select
                    id="feedbackStage"
                    className="select"
                    value={feedbackForm.stage}
                    onChange={updateFeedback("stage")}
                  >
                    {stages.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Rating (1-5)" htmlFor="rating">
                  <select
                    id="rating"
                    className="select"
                    value={feedbackForm.rating}
                    onChange={updateFeedback("rating")}
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>
                        {value} / 5
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Recommendation" htmlFor="recommendation">
                  <select
                    id="recommendation"
                    className="select"
                    value={feedbackForm.recommendation}
                    onChange={updateFeedback("recommendation")}
                  >
                    {RECOMMENDATIONS.map((value) => (
                      <option key={value} value={value}>
                        {value.charAt(0) + value.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid grid-2">
                <Field label="Strengths" htmlFor="strengths">
                  <textarea
                    id="strengths"
                    className="textarea"
                    rows={2}
                    placeholder="What went well?"
                    value={feedbackForm.strengths}
                    onChange={updateFeedback("strengths")}
                  />
                </Field>
                <Field label="Concerns" htmlFor="concerns">
                  <textarea
                    id="concerns"
                    className="textarea"
                    rows={2}
                    placeholder="Anything that worried you?"
                    value={feedbackForm.concerns}
                    onChange={updateFeedback("concerns")}
                  />
                </Field>
              </div>

              <Field label="Overall comment" htmlFor="comment">
                <textarea
                  id="comment"
                  className="textarea"
                  rows={2}
                  value={feedbackForm.comment}
                  onChange={updateFeedback("comment")}
                />
              </Field>

              <button className="btn btn-primary" disabled={busy}>
                Save my feedback
              </button>
              <p className="field-hint">
                You get one score per stage — saving again updates the one you already left.
              </p>
            </form>
          </div>

          <div className="card">
            <div className="card-title">
              <h2>Interviews</h2>
              <span className="muted small">{interviews.length} scheduled</span>
            </div>

            {interviews.length > 0 && (
              <ul className="list mb-2">
                {interviews.map((interview) => (
                  <li key={interview.id}>
                    <div>
                      <div className="cell-title">
                        {interview.stage} · {formatDateTime(interview.scheduledAt)}
                      </div>
                      <div className="cell-sub">
                        {interview.interviewerName || "Interviewer not set"}
                        {interview.interviewerEmail ? " · " + interview.interviewerEmail : ""}
                      </div>
                      {interview.notes && <div className="cell-sub">{interview.notes}</div>}
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => cancelInterview(interview.id)}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={scheduleInterview}>
              <div className="grid grid-2">
                <Field label="Stage" htmlFor="stage">
                  <select
                    id="stage"
                    className="select"
                    value={interviewForm.stage}
                    onChange={updateInterview("stage")}
                  >
                    {stages.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date and time" htmlFor="scheduledAt">
                  <input
                    id="scheduledAt"
                    className="input"
                    type="datetime-local"
                    required
                    value={interviewForm.scheduledAt}
                    onChange={updateInterview("scheduledAt")}
                  />
                </Field>
                <Field label="Interviewer" htmlFor="interviewerName">
                  <input
                    id="interviewerName"
                    className="input"
                    placeholder="Who is running it?"
                    value={interviewForm.interviewerName}
                    onChange={updateInterview("interviewerName")}
                  />
                </Field>
                <Field label="Interviewer email" htmlFor="interviewerEmail">
                  <input
                    id="interviewerEmail"
                    className="input"
                    type="email"
                    placeholder="name@company.com"
                    value={interviewForm.interviewerEmail}
                    onChange={updateInterview("interviewerEmail")}
                  />
                </Field>
              </div>

              <Field label="Notes" htmlFor="interviewNotes">
                <textarea
                  id="interviewNotes"
                  className="textarea"
                  rows={2}
                  placeholder="Format, room / meeting link, what to prepare…"
                  value={interviewForm.notes}
                  onChange={updateInterview("notes")}
                />
              </Field>

              <button className="btn btn-primary" disabled={busy}>
                Schedule interview
              </button>
            </form>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-title">
              <h2>CV</h2>
              <CvStatusBadge status={application.cvStatus} hasCv={Boolean(application.cv)} />
            </div>

            {application.cv ? (
              <div className="mt-2">
                <div className="stack">
                  <a className="cell-title" href={api.cvDownloadUrl(application.id)}>
                    {application.cv.filename}
                  </a>
                  <span className="cell-sub">
                    {formatBytes(application.cv.size)} · uploaded {formatDate(application.cv.uploadedAt)}
                  </span>
                </div>
                <div className="btn-row mt-2">
                  <a className="btn btn-secondary btn-sm" href={api.cvDownloadUrl(application.id)}>
                    Download
                  </a>
                  <button className="btn btn-ghost btn-sm" onClick={removeCv} disabled={busy}>
                    Remove
                  </button>
                </div>

                {/* This is the decision the client is waiting on. */}
                <div className="btn-row mt-3">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => reviewCv("ACCEPTED")}
                    disabled={busy || application.cvStatus === "ACCEPTED"}
                  >
                    Accept CV
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => reviewCv("REJECTED")}
                    disabled={busy || application.cvStatus === "REJECTED"}
                  >
                    Reject CV
                  </button>
                </div>
                <p className="field-hint">
                  The candidate sees this decision on their own “My applications” page.
                </p>
              </div>
            ) : (
              <p className="muted small mt-1">No CV has been uploaded yet.</p>
            )}

            <form onSubmit={uploadCv} className="mt-3">
              <Field
                label={application.cv ? "Replace the CV" : "Upload a CV"}
                htmlFor="cv"
                hint="PDF, DOC or DOCX · maximum 5 MB."
              >
                <input
                  id="cv"
                  className="input"
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(event) => setCvFile(event.target.files?.[0] || null)}
                />
              </Field>
              <button className="btn btn-primary btn-block" disabled={busy || !cvFile}>
                {busy ? "Uploading…" : application.cv ? "Replace CV" : "Upload CV"}
              </button>
            </form>
          </div>

          <div className="card">
            <h2>Application</h2>
            <div className="detail-grid mt-2">
              <div>
                <div className="detail-label">Vacancy</div>
                <div className="detail-value">
                  <Link to={"/jobs/" + application.jobId}>{application.jobTitle}</Link>
                </div>
              </div>
              <div>
                <div className="detail-label">Current stage</div>
                <div className="detail-value">{application.currentStage}</div>
              </div>
              <div>
                <div className="detail-label">Last updated</div>
                <div className="detail-value">{formatDateTime(application.updatedAt)}</div>
              </div>
            </div>

            <button className="btn btn-danger btn-block mt-3" onClick={withdraw} disabled={busy}>
              Delete application
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
