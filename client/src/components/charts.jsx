import { useState } from "react";

/**
 * RPT-01 - the charts on the dashboard.
 *
 * Hand-drawn inline SVG rather than a charting library. Three small bar
 * charts do not justify 200kB of dependency, and every value here can be
 * explained in a viva, which a library's defaults cannot.
 *
 * COLOURS. The brand amber #fbb401 is a fill for large areas carrying
 * dark text - as a small mark on white it measures 1.81:1, which is
 * unreadable. The chart colours are the amber and green stepped down
 * until they pass: #c08400 and #0f7a45 clear the lightness band, the
 * chroma floor, contrast against white, and a colour-blind separation of
 * ΔE 10.2 for protanopia. They were checked with a validator, not by eye.
 *
 * Nothing here is identified by colour alone: every bar is labelled with
 * its own name and number, two-series charts carry a legend, and each
 * chart can be switched to a table.
 */

const AMBER = "#c08400";
const GREEN = "#0f7a45";

// CV bands are ordered, not unrelated categories, so they take one hue
// from dark to light. Unrated is deliberately outside the ramp - "not
// looked at yet" is an absence, not a rung on the scale.
const BAND_COLOR = {
  HIGH: "#8a5a00",
  MEDIUM: "#c08400",
  LOW: "#e8b13d",
  UNRATED: "#b9bfc9",
};
const BAND_LABEL = { HIGH: "High", MEDIUM: "Medium", LOW: "Low", UNRATED: "Not screened" };

const INK = "#1e2228";
const MUTED = "#60697b";
const GRID = "#edf0f5";

/** A chart card: title, an optional table toggle, and the figure. */
function Figure({ title, note, table, children }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="chart">
      <div className="chart-head">
        <div>
          <h3>{title}</h3>
          {note && <p className="chart-note">{note}</p>}
        </div>
        {table && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowTable((open) => !open)}
            aria-expanded={showTable}
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        )}
      </div>
      {showTable && table ? table : children}
    </div>
  );
}

function Legend({ items }) {
  return (
    <ul className="chart-legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className="chart-swatch" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Horizontal bars. Horizontal because the labels are stage names and
 * people's names - rotated text is a readability problem nobody has to
 * have.
 */
function Bars({ rows, color, max, unit = "" }) {
  const top = Math.max(max ?? 0, ...rows.map((r) => r.value), 1);

  return (
    <div className="bars">
      {rows.map((row) => {
        const pct = (row.value / top) * 100;
        return (
          <div className="bar-row" key={row.label}>
            <span className="bar-label" title={row.label}>
              {row.label}
            </span>
            <span className="bar-track">
              <span
                className="bar-fill"
                style={{
                  width: Math.max(pct, row.value > 0 ? 1.5 : 0) + "%",
                  background: typeof color === "function" ? color(row) : color,
                }}
                title={row.label + ": " + row.value + unit}
              />
            </span>
            <span className="bar-value">{row.value}</span>
          </div>
        );
      })}
    </div>
  );
}

function plainTable(headers, rows) {
  return (
    <div className="table-wrap chart-table">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Where candidates are sitting, per position.
 *
 * This is the drop-off view the project plan asks for: the shape of the
 * bars shows where people stop moving.
 */
export function PipelineChart({ byStage }) {
  const jobs = [...new Set(byStage.map((r) => r.jobTitle))];
  if (!byStage.length) {
    return (
      <Figure title="Where candidates are sitting">
        <p className="muted small">No active candidates yet.</p>
      </Figure>
    );
  }

  const max = Math.max(...byStage.map((r) => r.total));

  return (
    <Figure
      title="Where candidates are sitting"
      note="Active and on-hold candidates by stage. A stage that stays full is where people stop moving."
      table={plainTable(
        ["Position", "Stage", "Candidates"],
        byStage.map((r) => [r.jobTitle, r.stage, r.total])
      )}
    >
      {jobs.map((job) => (
        <div className="chart-group" key={job}>
          <h4 className="chart-group-title">{job}</h4>
          <Bars
            rows={byStage
              .filter((r) => r.jobTitle === job)
              .map((r) => ({ label: r.stage, value: r.total }))}
            color={AMBER}
            max={max}
          />
        </div>
      ))}
    </Figure>
  );
}

/** CV screening progress - an ordered scale, so one hue dark to light. */
export function ScreeningChart({ byBand }) {
  const order = ["HIGH", "MEDIUM", "LOW", "UNRATED"];
  const rows = order
    .map((band) => ({
      label: BAND_LABEL[band],
      value: byBand.find((b) => b.band === band)?.total ?? 0,
      band,
    }))
    .filter((r) => r.value > 0);

  if (!rows.length) {
    return (
      <Figure title="CV screening">
        <p className="muted small">No candidates yet.</p>
      </Figure>
    );
  }

  const screened = rows.filter((r) => r.band !== "UNRATED").reduce((a, b) => a + b.value, 0);
  const total = rows.reduce((a, b) => a + b.value, 0);

  return (
    <Figure
      title="CV screening"
      note={screened + " of " + total + " CVs banded. Work through High first."}
      table={plainTable(["Band", "Candidates"], rows.map((r) => [r.label, r.value]))}
    >
      <Bars rows={rows} color={(r) => BAND_COLOR[r.band]} />
    </Figure>
  );
}

/**
 * Are interviewers keeping up?
 *
 * Two series, so a legend is required - and both are direct-labelled as
 * well, because identity must never rest on colour alone.
 */
export function InterviewerChart({ interviewerActivity }) {
  const rows = interviewerActivity.filter((r) => r.interviews > 0);
  if (!rows.length) {
    return (
      <Figure title="Interviewer feedback">
        <p className="muted small">No interviews have taken place yet.</p>
      </Figure>
    );
  }

  const max = Math.max(...rows.map((r) => r.interviews));

  return (
    <Figure
      title="Interviewer feedback"
      note="Feedback given against feedback still owed. Outstanding feedback is what blocks a candidate from moving."
      table={plainTable(
        ["Interviewer", "Interviews", "Feedback given", "Outstanding", "Average score"],
        rows.map((r) => [
          r.name,
          r.interviews,
          r.feedback,
          r.outstanding,
          r.averageScore ?? "—",
        ])
      )}
    >
      <Legend
        items={[
          { label: "Feedback given", color: GREEN },
          { label: "Still outstanding", color: AMBER },
        ]}
      />
      {rows.map((person) => (
        <div className="chart-group" key={person.name}>
          <h4 className="chart-group-title">
            {person.name}
            {person.averageScore != null && (
              <span className="muted small"> · average {person.averageScore} / 5</span>
            )}
          </h4>
          <Bars
            rows={[
              { label: "Given", value: person.feedback },
              { label: "Outstanding", value: person.outstanding },
            ]}
            color={(r) => (r.label === "Given" ? GREEN : AMBER)}
            max={max}
          />
        </div>
      ))}
    </Figure>
  );
}

/** A single headline number. Not every figure needs to be a chart. */
export function StatRow({ stats }) {
  return (
    <div className="grid grid-4">
      {stats.map((s) => (
        <div className="stat" key={s.label}>
          <div className="stat-label">{s.label}</div>
          <div className="stat-value">{s.value}</div>
          {s.note && <div className="muted small">{s.note}</div>}
        </div>
      ))}
    </div>
  );
}
