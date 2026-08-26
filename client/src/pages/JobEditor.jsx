import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Alert, Field, Loading } from "../components/ui.jsx";

const DEFAULT_STAGES = ["Applied", "Screening", "Interview", "Offer", "Hired"];
const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Internship"];

export default function JobEditor({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = mode === "edit";

  const [form, setForm] = useState({
    title: "",
    department: "",
    location: "",
    employmentType: "Full-time",
    salaryRange: "",
    closingDate: "",
    description: "",
  });
  const [stages, setStages] = useState(DEFAULT_STAGES);
  const [newStage, setNewStage] = useState("");
  const [loading, setLoading] = useState(isEdit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isEdit) return;
    api
      .getJob(id)
      .then(({ job }) => {
        setForm({
          title: job.title,
          department: job.department || "",
          location: job.location || "",
          employmentType: job.employmentType,
          salaryRange: job.salaryRange || "",
          closingDate: job.closingDate || "",
          description: job.description || "",
        });
        setStages(job.stages?.length ? job.stages : DEFAULT_STAGES);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  function update(key) {
    return (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  function addStage() {
    const name = newStage.trim();
    if (!name) return;
    if (stages.some((stage) => stage.toLowerCase() === name.toLowerCase())) {
      setError("That stage is already in the pipeline.");
      return;
    }
    setStages((current) => [...current, name]);
    setNewStage("");
    setError("");
  }

  function removeStage(name) {
    if (stages.length === 1) {
      setError("A position needs at least one interview stage.");
      return;
    }
    setStages((current) => current.filter((stage) => stage !== name));
  }

  function moveStage(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload = { ...form, stages };
      const result = isEdit ? await api.updateJob(id, payload) : await api.createJob(payload);
      navigate("/positions/" + result.job.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (loading) return <Loading what="this position" />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link className="small" to={isEdit ? "/positions/" + id : "/jobs"}>
            ← Back
          </Link>
          <h1 className="mt-1">{isEdit ? "Edit position" : "New position"}</h1>
          <p className="subtitle">
            Fill in the role details and set the interview stages candidates will move through.
          </p>
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      <form onSubmit={handleSubmit}>
        <div className="card">
          <h2>Role details</h2>

          <div className="mt-2">
            <Field label="Job title" htmlFor="title">
              <input
                id="title"
                className="input"
                required
                maxLength={120}
                placeholder="Junior Software Engineer"
                value={form.title}
                onChange={update("title")}
              />
            </Field>

            <div className="grid grid-2">
              <Field label="Department" htmlFor="department">
                <input
                  id="department"
                  className="input"
                  maxLength={80}
                  placeholder="Engineering"
                  value={form.department}
                  onChange={update("department")}
                />
              </Field>
              <Field label="Location" htmlFor="location">
                <input
                  id="location"
                  className="input"
                  maxLength={120}
                  placeholder="Colombo, Sri Lanka"
                  value={form.location}
                  onChange={update("location")}
                />
              </Field>
              <Field label="Employment type" htmlFor="employmentType">
                <select
                  id="employmentType"
                  className="select"
                  value={form.employmentType}
                  onChange={update("employmentType")}
                >
                  {EMPLOYMENT_TYPES.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </Field>
              <Field label="Salary range" htmlFor="salaryRange">
                <input
                  id="salaryRange"
                  className="input"
                  maxLength={80}
                  placeholder="LKR 120,000 - 160,000"
                  value={form.salaryRange}
                  onChange={update("salaryRange")}
                />
              </Field>
            </div>

            <Field label="Closing date" htmlFor="closingDate" hint="Leave empty for an open-ended position.">
              <input
                id="closingDate"
                className="input"
                type="date"
                value={form.closingDate}
                onChange={update("closingDate")}
              />
            </Field>

            <Field label="Description" htmlFor="description">
              <textarea
                id="description"
                className="textarea"
                rows={6}
                maxLength={5000}
                placeholder="Responsibilities, requirements, what the team works on…"
                value={form.description}
                onChange={update("description")}
              />
            </Field>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <h2>Interview stages</h2>
            <span className="muted small">Candidates move through these in order.</span>
          </div>

          <div className="chips">
            {stages.map((stage, index) => (
              <span className="chip" key={stage}>
                <button
                  type="button"
                  onClick={() => moveStage(index, -1)}
                  disabled={index === 0}
                  aria-label={"Move " + stage + " earlier"}
                  title="Move earlier"
                >
                  ‹
                </button>
                {index + 1}. {stage}
                <button
                  type="button"
                  onClick={() => moveStage(index, 1)}
                  disabled={index === stages.length - 1}
                  aria-label={"Move " + stage + " later"}
                  title="Move later"
                >
                  ›
                </button>
                <button type="button" onClick={() => removeStage(stage)} aria-label={"Remove " + stage}>
                  ✕
                </button>
              </span>
            ))}
          </div>

          <div className="input-with-button">
            <input
              className="input"
              placeholder="Add a stage, e.g. Technical Interview"
              maxLength={60}
              value={newStage}
              onChange={(event) => setNewStage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addStage();
                }
              }}
            />
            <button type="button" className="btn btn-secondary" onClick={addStage}>
              Add stage
            </button>
          </div>
          {isEdit && (
            <p className="field-hint">
              A stage cannot be removed while candidates are still sitting on it.
            </p>
          )}
        </div>

        <div className="btn-row mt-2">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create position"}
          </button>
          <Link className="btn btn-secondary" to={isEdit ? "/positions/" + id : "/jobs"}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
