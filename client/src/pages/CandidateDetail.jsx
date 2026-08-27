import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  BAND_LABEL,
  BANDS,
  BandBadge,
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

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];
const RECOMMENDATIONS = ["ADVANCE", "HOLD", "REJECT"];

/** One candidate: their CV, where they are in the process, the feedback
 *  from each interviewer, and the interviews booked for them. */
export default function CandidateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const p = user?.permissions || {};

  const [candidate, setCandidate] = useState(null);
  const [interviews, setInterviews] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [interviewers, setInterviewers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Arriving straight from "Add candidate". Say what just happened, and
  // what is left to do - the CV and the interview are both on this page.
  const location = useLocation();
  useEffect(() => {
    const state = location.state;
    if (!state?.justAdded) return;
    setMessage(
      "Added." +
        (state.emailed ? " We have emailed " + state.emailed + " to confirm." : "") +
        " Upload their CV below, and book an interview when you are ready."
    );
    // Clear it so a refresh does not show the message again.
    window.history.replaceState({}, "");
  }, [location.state]);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [outcome, setOutcome] = useState("ACTIVE");
  const [cvFile, setCvFile] = useState(null);

  const [interviewForm, setInterviewForm] = useState({
    stage: "",
    scheduledAt: "",
    interviewerId: "",
    location: "",
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
      const result = await api.getCandidate(id);
      setCandidate(result.candidate);
      setInterviews(result.interviews);
      setFeedback(result.feedback || []);
      setOutcome(result.candidate.outcome);
      setEditForm({
        fullName: result.candidate.fullName,
        email: result.candidate.email,
        phone: result.candidate.phone || "",
        source: result.candidate.source || "",
        notes: result.candidate.notes || "",
      });
      setInterviewForm((current) => ({
        ...current,
        stage: current.stage || result.candidate.currentStage,
      }));
      setFeedbackForm((current) => ({
        ...current,
        stage: current.stage || result.candidate.currentStage,
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

  useEffect(() => {
    api
      .interviewers()
      .then((result) => setInterviewers(result.interviewers))
      .catch(() => {});
  }, []);

  /** Every action refreshes from the server response, so what is on
   *  screen always matches what is in the database. */
  async function run(action, successMessage) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await action();
      if (result?.candidate) setCandidate((current) => ({ ...current, ...result.candidate }));
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
    const result = await run(() => api.advanceCandidate(id), null);
    if (result) {
      setMessage("Moved to " + result.candidate.currentStage + ".");
      await load();
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    const result = await run(() => api.updateCandidate(id, editForm), "Details saved.");
    if (result) setEditing(false);
  }

  async function saveOutcome() {
    const result = await run(
      () => api.updateCandidate(id, { outcome }),
      "Outcome recorded as " + OUTCOME_LABEL[outcome] + "."
    );
    if (result) await load();
  }

  async function setBand(band) {
    await run(() => api.bandCv(id, band, ""), "CV screened as " + BAND_LABEL[band] + ".");
  }

  async function uploadCv(event) {
    event.preventDefault();
    if (!cvFile) return;
    const form = event.target;
    const result = await run(() => api.uploadCv(id, cvFile), "CV uploaded.");
    if (result) {
      setCvFile(null);
      form.reset();
    }
  }

  async function removeCv() {
    if (!window.confirm("Remove this CV?")) return;
    await run(() => api.deleteCv(id), "CV removed.");
  }

  async function submitFeedback(event) {
    event.preventDefault();
    const result = await run(
      () =>
        api.leaveFeedback({
          candidateId: Number(id),
          ...feedbackForm,
          rating: Number(feedbackForm.rating),
        }),
      "Your feedback was saved."
    );
    if (result?.feedback) {
      // One entry per person per stage: replace mine if already there.
      setFeedback((current) => [
        result.feedback,
        ...current.filter((item) => item.id !== result.feedback.id),
      ]);
      setFeedbackForm((current) => ({ ...current, strengths: "", concerns: "", comment: "" }));
      await load();
    }
  }

  async function removeFeedback(feedbackId) {
    if (!window.confirm("Delete your feedback?")) return;
    const result = await run(() => api.deleteFeedback(feedbackId), "Feedback deleted.");
    if (result) setFeedback((current) => current.filter((item) => item.id !== feedbackId));
  }

  async function scheduleInterview(event) {
    event.preventDefault();
    const result = await run(
      () =>
        api.scheduleInterview({
          candidateId: Number(id),
          ...interviewForm,
          interviewerId: interviewForm.interviewerId || undefined,
        }),
      "Interview booked. The interviewer has been notified and the candidate's email is in the outbox."
    );
    if (result?.interview) {
      setInterviews((current) =>
        [...current, result.interview].sort(
          (a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)
        )
      );
      setInterviewForm((current) => ({ ...current, scheduledAt: "", location: "", notes: "" }));
    }
  }

  async function cancelInterview(interviewId) {
    if (!window.confirm("Cancel this interview? The candidate will be emailed.")) return;
    const result = await run(() => api.cancelInterview(interviewId), "Interview cancelled.");
    if (result) setInterviews((current) => current.filter((i) => i.id !== interviewId));
  }

  async function removeCandidate() {
    if (!window.confirm("Delete this candidate and their CV? This cannot be undone.")) return;
    const result = await run(() => api.deleteCandidate(id), null);
    if (result) navigate("/candidates", { replace: true });
  }

  const updateEdit = (key) => (event) =>
    setEditForm((current) => ({ ...current, [key]: event.target.value }));
  const updateInterview = (key) => (event) =>
    setInterviewForm((current) => ({ ...current, [key]: event.target.value }));
  const updateFeedback = (key) => (event) =>
    setFeedbackForm((current) => ({ ...current, [key]: event.target.value }));

  if (loading) return <Loading what="this candidate" />;
  if (!candidate) {
    return (
      <div className="page">
        <Alert kind="error">{error || "That candidate could not be found."}</Alert>
        <Link className="btn btn-secondary" to="/candidates">
          Back to candidates
        </Link>
      </div>
    );
  }

  const stages = candidate.stages || [];
  const stageIndex = stages.indexOf(candidate.currentStage);
  const nextStage =
    stageIndex >= 0 && stageIndex < stages.length - 1 ? stages[stageIndex + 1] : null;
  const averageRating = candidate.averageRating;
  const needsFeedbackFirst = nextStage && candidate.stageFeedbackCount === 0 && stageIndex > 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to="/candidates">
            ← All candidates
          </Link>
          <h1 className="mt-1">{candidate.fullName}</h1>
          <p className="subtitle">
            <Link to={"/positions/" + candidate.jobId}>{candidate.jobTitle}</Link> · added{" "}
            {formatDate(candidate.createdAt)}
            {candidate.addedByName ? " by " + candidate.addedByName : ""}
          </p>
        </div>
        <div className="btn-row">
          <BandBadge band={candidate.cvBand} />
          <OutcomeBadge outcome={candidate.outcome} />
          {p["candidate:edit"] && (
            <button className="btn btn-secondary" onClick={() => setEditing((c) => !c)}>
              {editing ? "Cancel edit" : "Edit details"}
            </button>
          )}
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>
      <Alert kind="success" onDismiss={() => setMessage("")}>
        {message}
      </Alert>

      {/* ---- progress ---- */}
      <div className="card">
        <div className="card-title">
          <h2>Progress</h2>
          <span className="muted small">
            Stage {stageIndex + 1} of {stages.length}
            {averageRating !== null && averageRating !== undefined
              ? " · average score " + averageRating + " / 5"
              : ""}
          </span>
        </div>

        <Pipeline stages={stages} currentStage={candidate.currentStage} />

        {(p["candidate:advance"] || p["candidate:outcome"]) && (
          <>
            <div className="btn-row mt-3">
              {p["candidate:advance"] && (
                <button className="btn btn-primary" onClick={advance} disabled={busy || !nextStage}>
                  {nextStage ? "Move to " + nextStage : "Final stage reached"}
                </button>
              )}
              {needsFeedbackFirst && (
                <span className="badge badge-amber">
                  Needs feedback for {candidate.currentStage} first
                </span>
              )}

              {p["candidate:outcome"] && (
                <>
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
                    disabled={busy || outcome === candidate.outcome}
                  >
                    Record outcome
                  </button>
                </>
              )}
            </div>
            <p className="field-hint">
              Nobody moves forward on missing information: feedback for the current stage has to be
              submitted first. Hiring or rejecting a candidate also writes an email to the outbox.
            </p>
          </>
        )}
      </div>

      <div className="grid grid-sidebar mt-2">
        <div>
          {/* ---- details ---- */}
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

                <Field label="Internal notes" htmlFor="notes">
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
                    Save changes
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
                    <div className="detail-value">{candidate.email}</div>
                  </div>
                  <div>
                    <div className="detail-label">Phone</div>
                    <div className="detail-value">{candidate.phone || "—"}</div>
                  </div>
                  <div>
                    <div className="detail-label">Source</div>
                    <div className="detail-value">{candidate.source || "—"}</div>
                  </div>
                  <div>
                    <div className="detail-label">Current stage</div>
                    <div className="detail-value">{candidate.currentStage}</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="detail-label">Internal notes</div>
                  <p className="detail-value" style={{ whiteSpace: "pre-wrap" }}>
                    {candidate.notes || "—"}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* ---- feedback ---- */}
          <div className="card">
            <div className="card-title">
              <h2>Interview feedback</h2>
              <span className="muted small">
                {feedback.length} review{feedback.length === 1 ? "" : "s"}
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

            {p["feedback:write"] ? (
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
                  Everyone scores out of 5 with the same options, which is what makes the
                  side-by-side comparison fair. Saving again updates the score you already left.
                </p>
              </form>
            ) : (
              <p className="muted small">Your role can read feedback but not write it.</p>
            )}
          </div>

          {/* ---- interviews ---- */}
          <div className="card">
            <div className="card-title">
              <h2>Interviews</h2>
              <span className="muted small">{interviews.length} booked</span>
            </div>

            {interviews.length > 0 && (
              <ul className="list mb-2">
                {interviews.map((iv) => (
                  <li key={iv.id}>
                    <div>
                      <div className="cell-title">
                        {iv.stage} · {formatDateTime(iv.scheduledAt)}
                      </div>
                      <div className="cell-sub">
                        {iv.interviewerName || "Interviewer not set"}
                        {iv.location ? " · " + iv.location : ""}
                      </div>
                      {iv.notes && <div className="cell-sub">{iv.notes}</div>}
                    </div>
                    {p["interview:schedule"] && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => cancelInterview(iv.id)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {p["interview:schedule"] && (
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
                  <Field
                    label="Interviewer"
                    htmlFor="interviewerId"
                    hint="They are notified in the app straight away."
                  >
                    <select
                      id="interviewerId"
                      className="select"
                      value={interviewForm.interviewerId}
                      onChange={updateInterview("interviewerId")}
                    >
                      <option value="">Choose an interviewer…</option>
                      {interviewers.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name} ({person.roleLabel})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Where" htmlFor="location">
                    <input
                      id="location"
                      className="input"
                      placeholder="Meeting room 2, or a video link"
                      value={interviewForm.location}
                      onChange={updateInterview("location")}
                    />
                  </Field>
                </div>

                <Field label="Notes for the invitation" htmlFor="interviewNotes">
                  <textarea
                    id="interviewNotes"
                    className="textarea"
                    rows={2}
                    placeholder="Format, what to prepare, who else will attend…"
                    value={interviewForm.notes}
                    onChange={updateInterview("notes")}
                  />
                </Field>

                <button className="btn btn-primary" disabled={busy}>
                  Book interview
                </button>
                <p className="field-hint">
                  Booking notifies the interviewer in the app and writes the candidate's invitation
                  email into the outbox for you to send.
                </p>
              </form>
            )}
          </div>
        </div>

        {/* ---- sidebar: CV ---- */}
        <div>
          <div className="card">
            <div className="card-title">
              <h2>CV</h2>
              <BandBadge band={candidate.cvBand} />
            </div>

            {candidate.cv ? (
              <div className="mt-2">
                <div className="stack">
                  <a className="cell-title" href={api.cvDownloadUrl(candidate.id)}>
                    {candidate.cv.filename}
                  </a>
                  <span className="cell-sub">
                    {formatBytes(candidate.cv.size)} · uploaded {formatDate(candidate.cv.uploadedAt)}
                  </span>
                </div>
                <div className="btn-row mt-2">
                  <a className="btn btn-secondary btn-sm" href={api.cvDownloadUrl(candidate.id)}>
                    Download
                  </a>
                  {p["candidate:uploadCv"] && (
                    <button className="btn btn-ghost btn-sm" onClick={removeCv} disabled={busy}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted small mt-1">No CV on file yet.</p>
            )}

            {p["candidate:band"] && (
              <div className="mt-3">
                <div className="detail-label">Screening band</div>
                <p className="field-hint">
                  One quick judgement so a large pile can be filtered instead of re-read.
                </p>
                <div className="btn-row mt-1">
                  {BANDS.map((value) => (
                    <button
                      key={value}
                      className={
                        "btn btn-sm " + (candidate.cvBand === value ? "btn-primary" : "btn-secondary")
                      }
                      onClick={() => setBand(value)}
                      disabled={busy}
                    >
                      {BAND_LABEL[value]}
                    </button>
                  ))}
                </div>
                {candidate.bandedByName && (
                  <p className="field-hint">
                    Screened by {candidate.bandedByName}
                    {candidate.cvBandedAt ? " on " + formatDate(candidate.cvBandedAt) : ""}.
                  </p>
                )}
              </div>
            )}

            {p["candidate:uploadCv"] && (
              <form onSubmit={uploadCv} className="mt-3">
                <Field
                  label={candidate.cv ? "Replace the CV" : "Upload their CV"}
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
                  {busy ? "Uploading…" : candidate.cv ? "Replace CV" : "Upload CV"}
                </button>
              </form>
            )}
          </div>

          {p["candidate:delete"] && (
            <div className="card">
              <h2>Danger zone</h2>
              <button className="btn btn-danger btn-block mt-2" onClick={removeCandidate} disabled={busy}>
                Delete candidate
              </button>
              <p className="field-hint">Removes their record, CV, interviews and feedback.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
