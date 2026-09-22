import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import {
  Alert,
  BandBadge,
  Empty,
  Loading,
  OutcomeBadge,
  Stars,
} from "../components/ui.jsx";

/**
 * FB-03 - "As a Hiring Manager, I want to view all interviewer feedback
 * for a candidate and compare candidates side-by-side, so that I can make
 * an evidence-based hiring decision."
 *
 * Two views of the same data:
 *
 *   RANKING      every candidate for the vacancy as a row, ordered by
 *                average score. Good for a first look across a pile.
 *   SIDE BY SIDE the candidates you tick, as COLUMNS, with the score at
 *                each stage and - the part the ranking cannot show -
 *                what each interviewer actually wrote about them. Two
 *                DevOps candidates on 4.0 and 4.1 are not separated by
 *                the decimal; they are separated by the concerns.
 *
 * The selection lives in the URL (?ids=3,7), so a comparison can be
 * sent to a colleague and opens exactly as it was left.
 */

const MAX_COMPARE = 4;

const REC = {
  ADVANCE: { label: "Advance", cls: "badge-green" },
  HOLD: { label: "Hold", cls: "badge-amber" },
  REJECT: { label: "Reject", cls: "badge-red" },
};

export default function Compare() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const selected = useMemo(
    () =>
      (searchParams.get("ids") || "")
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0),
    [searchParams]
  );

  useEffect(() => {
    api
      .compare(id)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  function select(ids) {
    setError("");
    setSearchParams(ids.length ? { ids: ids.join(",") } : {}, { replace: true });
  }

  function toggle(candidateId) {
    if (selected.includes(candidateId)) {
      select(selected.filter((n) => n !== candidateId));
      return;
    }
    // Past four the columns get too narrow to read the feedback in them,
    // which is the whole reason for the side-by-side view.
    if (selected.length >= MAX_COMPARE) {
      setError("Compare up to " + MAX_COMPARE + " at a time - untick one first.");
      return;
    }
    select([...selected, candidateId]);
  }

  if (loading) return <Loading what="the comparison" />;
  if (!data) {
    return (
      <div className="page">
        <Alert kind="error">{error || "That vacancy could not be found."}</Alert>
        <Link className="btn btn-secondary" to="/vacancies">
          Back to vacancies
        </Link>
      </div>
    );
  }

  const { job, stages, candidates } = data;
  const rated = candidates.filter((candidate) => candidate.feedbackCount > 0);
  // Keep the order they were ticked in, so the columns do not jump about.
  const chosen = selected
    .map((sid) => candidates.find((c) => c.id === sid))
    .filter(Boolean);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to={"/vacancies/" + job.id}>
            ← {job.title}
          </Link>
          <h1 className="mt-1">Compare candidates</h1>
          <p className="subtitle">
            {candidates.length} candidate{candidates.length === 1 ? "" : "s"} for {job.title}. Tick
            two to four to put them side by side.
          </p>
        </div>
        {chosen.length > 0 && (
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={() => select([])}>
              Clear selection
            </button>
          </div>
        )}
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      {candidates.length === 0 ? (
        <div className="table-wrap">
          <Empty title="No candidates for this vacancy yet">
            <p>Add candidates to this vacancy and they will appear here once feedback is in.</p>
          </Empty>
        </div>
      ) : (
        <>
          {chosen.length >= 2 && (
            <SideBySide candidates={chosen} stages={stages} onRemove={toggle} />
          )}

          {chosen.length === 1 && (
            <Alert kind="info">
              {chosen[0].fullName} is selected. Tick at least one more to compare them side by
              side.
            </Alert>
          )}

          {rated.length === 0 && (
            <Alert kind="info">
              No interview feedback has been recorded yet, so there is nothing to rank on.
            </Alert>
          )}

          <h2 className="section-title">Ranking</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-check">
                    <span className="sr-only">Compare</span>
                  </th>
                  <th>Candidate</th>
                  <th>Overall</th>
                  {stages.map((stage) => (
                    <th key={stage}>{stage}</th>
                  ))}
                  <th>Recommendations</th>
                  <th>CV band</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => {
                  const on = selected.includes(candidate.id);
                  return (
                    <tr key={candidate.id} className={on ? "is-selected" : ""}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(candidate.id)}
                          aria-label={"Compare " + candidate.fullName}
                        />
                      </td>
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
                        <Votes votes={candidate.votes} />
                      </td>
                      <td>
                        <BandBadge band={candidate.cvBand} />
                      </td>
                      <td>
                        <OutcomeBadge outcome={candidate.outcome} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="field-hint mt-2">
            Each interviewer can leave one score per stage, so nobody can weight the result by
            writing twice.
          </p>
        </>
      )}
    </div>
  );
}

function Votes({ votes }) {
  return (
    <span className="votes">
      <span className="vote vote-advance" title="Advance">
        {votes.advance} advance
      </span>
      <span className="vote vote-hold" title="Hold">
        {votes.hold} hold
      </span>
      <span className="vote vote-reject" title="Reject">
        {votes.reject} reject
      </span>
    </span>
  );
}

/**
 * The candidates as columns. Every row is one question asked of all of
 * them at once, so the eye travels across and the difference is visible
 * rather than remembered.
 *
 * The strongest figure in a row is marked, but only when there is a
 * single clear leader - a tie is not a lead, and marking one of two equal
 * scores would invent a difference that is not there.
 */
function SideBySide({ candidates, stages, onRemove }) {
  const best = (values) => {
    const real = values.filter((v) => typeof v === "number");
    if (real.length < 2) return null;
    const top = Math.max(...real);
    return real.filter((v) => v === top).length === 1 ? top : null;
  };

  const overallBest = best(candidates.map((c) => c.averageRating));

  return (
    <section className="compare" aria-label="Side-by-side comparison">
      <div className="compare-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              <th className="compare-rowhead" />
              {candidates.map((c) => (
                <th key={c.id} className="compare-col">
                  <div className="compare-name">
                    <Link to={"/candidates/" + c.id}>{c.fullName}</Link>
                    <button
                      type="button"
                      className="compare-remove"
                      onClick={() => onRemove(c.id)}
                      aria-label={"Remove " + c.fullName + " from the comparison"}
                    >
                      ×
                    </button>
                  </div>
                  <div className="cell-sub">{c.email}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="compare-rowhead">Overall</th>
              {candidates.map((c) => (
                <td
                  key={c.id}
                  className={c.averageRating === overallBest ? "compare-best" : ""}
                >
                  <Stars value={c.averageRating} />
                  <div className="cell-sub">
                    {c.feedbackCount} review{c.feedbackCount === 1 ? "" : "s"}
                  </div>
                </td>
              ))}
            </tr>

            {stages.map((stage) => {
              const values = candidates.map((c) => c.stageRatings[stage]?.average ?? null);
              const top = best(values);
              return (
                <tr key={stage}>
                  <th className="compare-rowhead">{stage}</th>
                  {candidates.map((c, i) => (
                    <td key={c.id} className={values[i] !== null && values[i] === top ? "compare-best" : ""}>
                      {values[i] !== null ? (
                        <strong>{values[i]} / 5</strong>
                      ) : (
                        <span className="muted">Not scored</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}

            <tr>
              <th className="compare-rowhead">Recommendations</th>
              {candidates.map((c) => (
                <td key={c.id}>
                  <Votes votes={c.votes} />
                </td>
              ))}
            </tr>
            <tr>
              <th className="compare-rowhead">CV band</th>
              {candidates.map((c) => (
                <td key={c.id}>
                  <BandBadge band={c.cvBand} />
                </td>
              ))}
            </tr>
            <tr>
              <th className="compare-rowhead">Where they are</th>
              {candidates.map((c) => (
                <td key={c.id}>
                  {c.currentStage}
                  <div className="mt-1">
                    <OutcomeBadge outcome={c.outcome} />
                  </div>
                </td>
              ))}
            </tr>
            <tr>
              <th className="compare-rowhead">CV</th>
              {candidates.map((c) => (
                <td key={c.id}>
                  {c.hasCv ? (
                    <a className="btn btn-secondary btn-sm" href={api.cvDownloadUrl(c.id)}>
                      Download
                    </a>
                  ) : (
                    <span className="muted">None on file</span>
                  )}
                </td>
              ))}
            </tr>

            {/* The part the ranking cannot show: what was actually said,
                lined up stage by stage. */}
            {stages.map((stage) => {
              if (!candidates.some((c) => c.feedback.some((f) => f.stage === stage))) return null;
              return (
                <tr key={"words-" + stage} className="compare-words">
                  <th className="compare-rowhead">
                    What interviewers said
                    <div className="cell-sub">{stage}</div>
                  </th>
                  {candidates.map((c) => {
                    const notes = c.feedback.filter((f) => f.stage === stage);
                    return (
                      <td key={c.id}>
                        {notes.length === 0 ? (
                          <span className="muted">No feedback at this stage</span>
                        ) : (
                          notes.map((f, i) => (
                            <div className="compare-note" key={i}>
                              <div className="compare-note-head">
                                <strong>{f.authorName}</strong>
                                <span className={"badge " + (REC[f.recommendation]?.cls || "badge-grey")}>
                                  {REC[f.recommendation]?.label || f.recommendation}
                                </span>
                              </div>
                              <div className="cell-sub">{f.rating} / 5</div>
                              {f.strengths && (
                                <p className="compare-plus">
                                  <span aria-hidden="true">+</span> {f.strengths}
                                </p>
                              )}
                              {f.concerns && (
                                <p className="compare-minus">
                                  <span aria-hidden="true">−</span> {f.concerns}
                                </p>
                              )}
                              {f.comment && <p className="compare-comment">{f.comment}</p>}
                            </div>
                          ))
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="field-hint mt-1">
        A highlighted cell is the single strongest score in that row. Ties are not highlighted — a
        tie is not a lead.
      </p>
    </section>
  );
}
