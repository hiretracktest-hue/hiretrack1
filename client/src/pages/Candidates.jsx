import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
  CV_ACCEPT,
  CV_HINT,
  describeCvProblem,
  describeEmailProblem,
  describeFutureDateProblem,
  formatDate,
  nowForDateInput,
} from "../components/ui.jsx";

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];

// Everything the add form holds. inviteLink and inviteAt belong here
// too - left out, React treats those two inputs as uncontrolled and
// warns the first time anything is typed into them.
const BLANK_FORM = {
  jobId: "",
  fullName: "",
  email: "",
  phone: "",
  source: "",
  inviteLink: "",
  inviteAt: "",
};

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
  // FB-03. Ticking candidates also feeds the side-by-side comparison, so
  // anyone who may compare gets the tick boxes - management included,
  // who can compare but cannot band a CV and so never saw them.
  const canCompare = Boolean(user?.permissions?.["candidate:compare"]);
  const canSelect = canBand || canCompare;
  // The role itself, not a guess from a missing permission - management
  // cannot band a CV either, and was being told "you have nobody to
  // interview" as if it were an interviewer.
  const isInterviewer = user?.role === "interviewer";

  const canAdd = Boolean(user?.permissions?.["candidate:add"]);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState("");
  const [form, setForm] = useState(BLANK_FORM);
  // The CV is picked in the same form. A File cannot live in the object
  // above - it is not a value an input can be set back from - so it is
  // held on its own, and the file input is left uncontrolled and reset
  // through a key change once the candidate is saved.
  const [cvFile, setCvFile] = useState(null);
  const [cvKey, setCvKey] = useState(0);

  const [candidates, setCandidates] = useState([]);
  const [bandCounts, setBandCounts] = useState(null);
  const [jobs, setJobs] = useState([]);

  const [search, setSearch] = useState(searchParams.get("q") || "");

  // The search box in the top bar lands here with what was typed, as
  // navigation state. Only that is picked up - not this page's own
  // address-bar updates, which trail a moment behind the typing and
  // would otherwise snatch letters back out of the box.
  const location = useLocation();
  const fromTopBar = location.state?.at;
  useEffect(() => {
    if (fromTopBar) setSearch(location.state.search || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromTopBar]);
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

  /** Off to the new candidate's page with the booking form open. */
  function goToBooking(candidate, cvProblem) {
    navigate("/candidates/" + candidate.id, {
      state: { bookNow: true, cvProblem },
    });
  }

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

    // The CV is asked for here rather than on a second screen, because
    // it is the thing the shortlist is actually worked out from.
    const cvProblemNow = describeCvProblem(cvFile);
    if (cvProblemNow) problems.cv = cvProblemNow;

    setFormErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setAdding(true);
    setError("");
    setAdded("");
    try {
      // notify is not passed, so the server sends. There is no tick box
      // any more - somebody who applied always hears back.
      const result = await api.addCandidate({
        jobId: Number(form.jobId),
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        source: form.source,
        inviteLink: form.inviteLink,
        inviteAt: form.inviteAt,
      });

      // The CV needs the id, so it can only go up once the record
      // exists. If this half fails the person IS still added - say so
      // plainly, because re-submitting the form to "try again" would
      // only be refused as a duplicate.
      let cvProblem = "";
      try {
        await api.uploadCv(result.candidate.id, cvFile);
      } catch (err) {
        cvProblem = err.message;
      }

      setForm(BLANK_FORM);
      setCvFile(null);
      setCvKey((n) => n + 1);
      setFormErrors({});
      setShowAdd(false);

      // Straight to booking their interview. Adding somebody is never
      // the point on its own - the next thing that has to happen is
      // picking who sees them and when, and that is also what finally
      // emails the candidate. Making HR find the person again in a
      // list they just added them to is a step for no reason.
      goToBooking(result.candidate, cvProblem);
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
              Everything in one go - their CV included. Saving takes you straight on to
              booking their interview, which is what emails them.
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
                  hint="Leave it empty and nothing is emailed yet. Fill it in and they are told this time now - either way it is filled in for you on the booking form next."
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
                <Field
                  label="Their CV"
                  htmlFor="add-cv"
                  hint={CV_HINT}
                  error={formErrors.cv}
                >
                  <input
                    id="add-cv"
                    key={cvKey}
                    className={"input" + (formErrors.cv ? " input-error" : "")}
                    type="file"
                    accept={CV_ACCEPT}
                    onChange={(event) => {
                      setCvFile(event.target.files?.[0] || null);
                      setFormErrors((current) => {
                        if (!current.cv) return current;
                        const next = { ...current };
                        delete next.cv;
                        return next;
                      });
                    }}
                    aria-invalid={Boolean(formErrors.cv)}
                  />
                </Field>
              </div>

              <div className="btn-row mt-2">
                <button className="btn btn-primary" type="submit" disabled={adding}>
                  {adding ? "Saving…" : "Save candidate"}
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

      {canSelect && selected.length > 0 && (
        <div className="alert alert-info selection-bar">
          <div className="row-between">
            <span>
              <strong>{selected.length} selected.</strong>
              {canBand && <> Screen {selected.length === 1 ? "it" : "them all"} as:</>}
            </span>
            <div className="btn-row">
              {canBand &&
                BANDS.map((value) => (
                  <button
                    key={value}
                    className="btn btn-secondary btn-sm"
                    onClick={() => bandSelected(value)}
                    disabled={busy}
                  >
                    {BAND_LABEL[value]}
                  </button>
                ))}
              {canCompare && <CompareButton selected={selected} candidates={candidates} />}
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
                {canSelect && (
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
                  {canSelect && (
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

/**
 * FB-03 from the Candidates page, which is where you actually find "two
 * DevOps candidates" - by filtering to the vacancy and ticking them.
 *
 * A comparison only means something within one vacancy: the stages and
 * the questions are the vacancy's own, so a DevOps technical round and a
 * QA test task are not the same yardstick. Ticking across vacancies says
 * so rather than producing a meaningless table.
 */
function CompareButton({ selected, candidates }) {
  const navigate = useNavigate();
  const picked = candidates.filter((c) => selected.includes(c.id));
  const vacancies = [...new Set(picked.map((c) => c.jobId))];

  if (picked.length < 2) {
    return <span className="small muted">Tick one more to compare</span>;
  }
  if (vacancies.length > 1) {
    return (
      <span className="small muted">
        Compare works within one vacancy — tick candidates for the same role
      </span>
    );
  }
  if (picked.length > 4) {
    return <span className="small muted">Compare up to four at a time</span>;
  }
  return (
    <button
      className="btn btn-primary btn-sm"
      onClick={() =>
        navigate("/vacancies/" + vacancies[0] + "/compare?ids=" + picked.map((c) => c.id).join(","))
      }
    >
      Compare side by side →
    </button>
  );
}
