import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import {
  Alert,
  BAND_LABEL,
  BANDS,
  BandBadge,
  CvStatusBadge,
  Empty,
  Loading,
  OUTCOME_LABEL,
  OutcomeBadge,
  Stars,
  formatDate,
} from "../components/ui.jsx";

const OUTCOMES = ["ACTIVE", "ON_HOLD", "HIRED", "REJECTED"];

export default function Candidates() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const canBand = Boolean(user?.permissions?.["candidate:band"]);

  const [applications, setApplications] = useState([]);
  const [bandCounts, setBandCounts] = useState(null);
  const [band, setBand] = useState(searchParams.get("cvBand") || "");
  const [sort, setSort] = useState(searchParams.get("sort") || "newest");
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [job, setJob] = useState(searchParams.get("job") || "");
  const [outcome, setOutcome] = useState(searchParams.get("outcome") || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listJobs()
      .then((result) => setJobs(result.jobs))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      // Keep the filters in the address bar so the view can be shared.
      setSearchParams(
        Object.fromEntries(
          Object.entries({ q: search, job, outcome, cvBand: band, sort }).filter(
            ([key, value]) => value && !(key === "sort" && value === "newest")
          )
        ),
        { replace: true }
      );

      api
        .listApplications({ q: search, job, outcome, cvBand: band, sort })
        .then((result) => {
          setApplications(result.applications);
          setBandCounts(result.bandCounts || null);
          setSelected([]);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [search, job, outcome, band, sort, setSearchParams]);

  /** Band every selected CV in one go - screening in bulk. */
  async function bandSelected(value) {
    if (!selected.length) return;
    setBusy(true);
    setError("");
    try {
      await api.bandCvBulk(selected, value);
      const result = await api.listApplications({ q: search, job, outcome, cvBand: band, sort });
      setApplications(result.applications);
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Candidates</h1>
          <p className="subtitle">
            Everyone who has applied, across every vacancy. {applications.length} shown.
          </p>
        </div>
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

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {/* Screening bands. With hundreds of CVs this is how HR gets to
          the good ones without opening every file. */}
      {bandCounts && (
        <div className="band-bar">
          <button
            type="button"
            className={"band-chip" + (band === "" ? " active" : "")}
            onClick={() => setBand("")}
          >
            All <span className="count">{bandCounts.HIGH + bandCounts.MEDIUM + bandCounts.LOW + bandCounts.UNRATED}</span>
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
              {selected.length} selected. Band {selected.length === 1 ? "it" : "them all"} as:
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
        {(search || job || outcome || band) && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSearch("");
              setJob("");
              setOutcome("");
              setBand("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <Loading what="candidates" />
      ) : applications.length === 0 ? (
        <div className="table-wrap">
          <Empty title="No candidates match those filters">
            <p>Try clearing the search, or apply to a vacancy to create the first candidate.</p>
          </Empty>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canBand && <th style={{ width: 36 }} />}
                <th>Candidate</th>
                <th>Vacancy</th>
                <th>Band</th>
                <th>Score</th>
                <th>Stage</th>
                <th>Outcome</th>
                <th>CV</th>
                <th>Applied</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {applications.map((application) => (
                <tr key={application.id}>
                  {canBand && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(application.id)}
                        onChange={() => toggle(application.id)}
                        aria-label={"Select " + application.fullName}
                      />
                    </td>
                  )}
                  <td>
                    <Link className="cell-title" to={"/candidates/" + application.id}>
                      {application.fullName}
                    </Link>
                    <div className="cell-sub">{application.email}</div>
                  </td>
                  <td>
                    <Link to={"/jobs/" + application.jobId}>{application.jobTitle}</Link>
                    <div className="cell-sub">{application.jobDepartment || "—"}</div>
                  </td>
                  <td>
                    <BandBadge band={application.cvBand} />
                  </td>
                  <td>
                    <Stars value={application.averageRating} />
                  </td>
                  <td>{application.currentStage}</td>
                  <td>
                    <OutcomeBadge outcome={application.outcome} />
                  </td>
                  <td>
                    <CvStatusBadge status={application.cvStatus} hasCv={Boolean(application.cv)} />
                    {application.cv && (
                      <div className="cell-sub">
                        <a href={api.cvDownloadUrl(application.id)}>Download</a>
                      </div>
                    )}
                  </td>
                  <td className="cell-sub">{formatDate(application.createdAt)}</td>
                  <td className="cell-right">
                    <Link className="btn btn-secondary btn-sm" to={"/candidates/" + application.id}>
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
