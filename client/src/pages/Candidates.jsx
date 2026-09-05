import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  Field,
  BAND_LABEL,
  BANDS,
  BandBadge,
  CvBadge,
  Empty,
  Loading,
  OUTCOME_LABEL,
  OutcomeBadge,
  Stars,
  describeEmailProblem,
  describeFutureDateProblem,
  formatDate,
  nowForDateInput,
} from "../components/ui.jsx";

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];

/**
 * Every candidate across every vacancy. The band filter is what makes
 * a large pile workable: screen each CV once, then work through the
 * High band first instead of re-reading everything.
 */
export default function Candidates() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canBand = Boolean(user?.permissions?.["candidate:band"]);
  const isInterviewer = !canBand;

  const canAdd = Boolean(user?.permissions?.["candidate:add"]);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState("");
  const [form, setForm] = useState({
    jobId: "",
    fullName: "",
    email: "",
    phone: "",
    source: "",
    // Somebody who applied should hear back, so telling them is the
    // default. HR turns it off for a name copied off a CV pile who has
    // not actually applied yet.
    notify: true,
  });

  const [candidates, setCandidates] = useState([]);
  const [bandCounts, setBandCounts] = useState(null);
  const [jobs, setJobs] = useState([]);

  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [job, setJob] = useState(searchParams.get("job") || "");
  const [outcome, setOutcome] = useState(searchParams.get("outcome") || "");
  const [band, setBand] = useState(searchParams.get("cvBand") || "");
  const [sort, setSort] = useState(searchParams.get("sort") || "newest");
  const [mineOnly, setMineOnly] = useState(searchParams.get("mine") === "1");

  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listJobs()
      .then((result) => setJobs(result.jobs))
      .catch((err) => setError(err.message));
  }, []);

  const fetchCandidates = useCallback(
    () =>
      api.listCandidates({
        q: search,
        job,
        outcome,
        cvBand: band,
        sort,
        mine: mineOnly ? 1 : "",
      }),
    [search, job, outcome, band, sort, mineOnly]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      // Keep the filters in the address bar so a view can be shared.
      setSearchParams(
        Object.fromEntries(
          Object.entries({
            q: search,
            job,
            outcome,
            cvBand: band,
            sort: sort === "newest" ? "" : sort,
            mine: mineOnly ? "1" : "",
          }).filter(([, value]) => value)
        ),
        { replace: true }
      );

      fetchCandidates()
        .then((result) => {
          setCandidates(result.candidates);
          setBandCounts(result.bandCounts || null);
          setSelected([]);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [fetchCandidates, search, job, outcome, band, sort, mineOnly, setSearchParams]);

  /** Screen several CVs in one go. */
  async function bandSelected(value) {
    if (!selected.length) return;
    setBusy(true);
    setError("");
    try {
      await api.bandCvBulk(selected, value);
      const result = await fetchCandidates();
      setCandidates(result.candidates);
      setBandCounts(result.bandCounts || null);
      setSelected([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id) {
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  }

  const allVisibleSelected = candidates.length > 0 && selected.length === candidates.length;

  // Per-field messages, so a bad email is flagged on the email box
  // rather than as one banner above the whole form.
  const [formErrors, setFormErrors] = useState({});

  const updateForm = (key) => (event) =>
    setForm((current) => {
      setFormErrors((errors) => {
        if (!errors[key]) return errors;
        const next = { ...errors };
        delete next[key];
        return next;
      });
      return {
        ...current,
        [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
      };
    });

  async function addCandidate(event) {
    event.preventDefault();

    // The server checks all of this again. Doing it here means the
    // answer appears on the field that caused it, with no round trip.
    const problems = {};
    if (!form.jobId) problems.jobId = "Choose which vacancy this candidate applied for.";
    if (!form.fullName.trim()) problems.fullName = "Enter the candidate's full name.";

    const emailProblem = describeEmailProblem(form.email);
    if (emailProblem) problems.email = emailProblem;

    // Optional, but if a time is given it cannot already have passed.
    const whenProblem = describeFutureDateProblem(form.inviteAt, {
      field: "That time",
      required: false,
    });
    if (whenProblem) problems.inviteAt = whenProblem;

    setFormErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setAdding(true);
    setError("");
    setAdded("");
    try {
      const result = await api.addCandidate({
        jobId: Number(form.jobId),
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        source: form.source,
        inviteLink: form.inviteLink,
        inviteAt: form.inviteAt,
        notify: form.notify,
      });
      // Straight to their page. Adding somebody is never the whole
      // job - their CV still has to go on, and an interview booked -
      // and both of those live there. Sending HR back to a list they
      // would immediately have to search just adds a step.
      navigate("/candidates/" + result.candidate.id, {
        state: {
          justAdded: true,
          email: result.email,
          address: result.candidate.email,
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  const openJobs = jobs.filter((j) => j.status === "ACTIVE");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Candidates</h1>
          <p className="subtitle">
            {candidates.length} shown
            {bandCounts ? " of " + Object.values(bandCounts).reduce((a, b) => a + b, 0) : ""}.
            {canBand && " Screen each CV once, then work through the High band first."}
          </p>
        </div>
        <div className="btn-row">
          {canAdd && (
            <button className="btn btn-primary" onClick={() => setShowAdd((c) => !c)}>
              {showAdd ? "Cancel" : "+ Add candidate"}
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => setMineOnly((c) => !c)}>
            {mineOnly ? "Show everyone" : "Only mine to interview"}
          </button>
          <select
            className="select"
            style={{ width: "auto" }}
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort candidates"
          >
            <option value="newest">Newest first</option>
            <option value="band">Best screened first</option>
            <option value="rating">Highest interview score</option>
            <option value="name">Name (A-Z)</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>
      <Alert kind="success" onDismiss={() => setAdded("")}>
        {added}
      </Alert>

      {showAdd && canAdd && (
        <div className="card mb-2">
          <div className="card-title">
            <h2>Add a candidate</h2>
            <span className="muted small">
              They start at the first stage of the vacancy. Upload their CV on their own page.
            </span>
          </div>

          {/* noValidate turns the browser's own pop-up off. The inputs still
              carry min/type so the picker and keyboard behave, but the
              message the person reads is ours - "that date is not
              available" rather than "Value must be ... or later". */}
          {openJobs.length === 0 ? (
            <p className="muted">
              There are no open vacancies to add anyone to. Open one first.
            </p>
          ) : (
            <form onSubmit={addCandidate} noValidate>
              <div className="grid grid-2">
                <Field label="Vacancy" htmlFor="add-job" error={formErrors.jobId}>
                  <select
                    id="add-job"
                    className={"select" + (formErrors.jobId ? " input-error" : "")}
                    value={form.jobId}
                    onChange={updateForm("jobId")}
                    aria-invalid={Boolean(formErrors.jobId)}
                  >
                    <option value="">Choose a vacancy…</option>
                    {openJobs.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Full name" htmlFor="add-name" error={formErrors.fullName}>
                  <input
                    id="add-name"
                    className={"input" + (formErrors.fullName ? " input-error" : "")}
                    minLength={2}
                    placeholder="Dilshan Herath"
                    value={form.fullName}
                    onChange={updateForm("fullName")}
                    aria-invalid={Boolean(formErrors.fullName)}
                  />
                </Field>
                <Field
                  label="Email"
                  htmlFor="add-email"
                  hint="Their real address — this is where their invitation will go."
                  error={formErrors.email}
                >
                  <input
                    id="add-email"
                    className={"input" + (formErrors.email ? " input-error" : "")}
                    type="email"
                    placeholder="dilshan.herath@gmail.com"
                    value={form.email}
                    onChange={updateForm("email")}
                    aria-invalid={Boolean(formErrors.email)}
                  />
                </Field>
                <Field label="Phone" htmlFor="add-phone">
                  <input
                    id="add-phone"
                    className="input"
                    placeholder="+94 77 123 4567"
                    value={form.phone}
                    onChange={updateForm("phone")}
                  />
                </Field>
                <Field label="Where did they come from?" htmlFor="add-source">
                  <input
                    id="add-source"
                    className="input"
                    placeholder="LinkedIn, referral, email application…"
                    value={form.source}
                    onChange={updateForm("source")}
                  />
                </Field>
                <Field
                  label="Link to send them (optional)"
                  htmlFor="add-link"
                  hint="A meeting link, a form, anything they should open. It becomes a button in their email."
                >
                  <input
                    id="add-link"
                    className="input"
                    placeholder="meet.google.com/abc-defg"
                    value={form.inviteLink}
                    onChange={updateForm("inviteLink")}
                  />
                </Field>
                <Field
                  label="Time to tell them (optional)"
                  htmlFor="add-when"
                  hint="Included in the email, and they are asked to reply if it does not suit."
                  error={formErrors.inviteAt}
                >
                  <input
                    id="add-when"
                    className={"input" + (formErrors.inviteAt ? " input-error" : "")}
                    type="datetime-local"
                    min={nowForDateInput()}
                    value={form.inviteAt}
                    onChange={updateForm("inviteAt")}
                    aria-invalid={Boolean(formErrors.inviteAt)}
                  />
                </Field>
              </div>

              <label className="check">
                <input type="checkbox" checked={form.notify} onChange={updateForm("notify")} />
                <span>
                  Email them to confirm we have their application
                  <span className="muted small">
                    {" "}
                    — turn this off for a name taken off a CV pile who has not applied yet.
                  </span>
                </span>
              </label>

              <div className="btn-row mt-2">
                <button className="btn btn-primary" type="submit" disabled={adding}>
                  {adding ? "Adding…" : "Add candidate"}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setShowAdd(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {bandCounts && (
        <div className="band-bar">
          <button
            type="button"
            className={"band-chip" + (band === "" ? " active" : "")}
            onClick={() => setBand("")}
          >
            All{" "}
            <span className="count">
              {Object.values(bandCounts).reduce((a, b) => a + b, 0)}
            </span>
          </button>
          {BANDS.map((value) => (
            <button
              key={value}
              type="button"
              className={"band-chip" + (band === value ? " active" : "")}
              onClick={() => setBand(band === value ? "" : value)}
            >
              {BAND_LABEL[value]} <span className="count">{bandCounts[value] ?? 0}</span>
            </button>
          ))}
        </div>
      )}

      {canBand && selected.length > 0 && (
        <div className="alert alert-info">
          <div className="row-between">
            <span>
              {selected.length} selected. Screen {selected.length === 1 ? "it" : "them all"} as:
            </span>
            <div className="btn-row">
              {BANDS.map((value) => (
                <button
                  key={value}
                  className="btn btn-secondary btn-sm"
                  onClick={() => bandSelected(value)}
                  disabled={busy}
                >
                  {BAND_LABEL[value]}
                </button>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

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
        {(search || job || outcome || band || mineOnly) && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSearch("");
              setJob("");
              setOutcome("");
              setBand("");
              setMineOnly(false);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <Loading what="candidates" />
      ) : candidates.length === 0 ? (
        <div className="table-wrap">
          <Empty title="No candidates match those filters">
            <p>
              {isInterviewer
                ? "You have nobody to interview at the moment."
                : "Try clearing the filters, or add a candidate from a vacancy."}
            </p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canBand && (
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() =>
                        setSelected(allVisibleSelected ? [] : candidates.map((c) => c.id))
                      }
                      aria-label="Select all"
                    />
                  </th>
                )}
                <th>Candidate</th>
                <th>Vacancy</th>
                <th>CV band</th>
                <th>Score</th>
                <th>Stage</th>
                <th>Outcome</th>
                <th>CV</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id}>
                  {canBand && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(candidate.id)}
                        onChange={() => toggle(candidate.id)}
                        aria-label={"Select " + candidate.fullName}
                      />
                    </td>
                  )}
                  <td>
                    <Link className="cell-title" to={"/candidates/" + candidate.id}>
                      {candidate.fullName}
                    </Link>
                    <div className="cell-sub">{candidate.email}</div>
                  </td>
                  <td>
                    <Link to={"/vacancies/" + candidate.jobId}>{candidate.jobTitle}</Link>
                    <div className="cell-sub">{candidate.jobDepartment || "—"}</div>
                  </td>
                  <td>
                    <BandBadge band={candidate.cvBand} />
                  </td>
                  <td>
                    <Stars value={candidate.averageRating} />
                  </td>
                  <td>{candidate.currentStage}</td>
                  <td>
                    <OutcomeBadge outcome={candidate.outcome} />
                  </td>
                  <td>
                    <CvBadge hasCv={Boolean(candidate.cv)} />
                  </td>
                  <td className="cell-sub">{formatDate(candidate.createdAt)}</td>
                  <td className="cell-right">
                    <Link className="btn btn-secondary btn-sm" to={"/candidates/" + candidate.id}>
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
