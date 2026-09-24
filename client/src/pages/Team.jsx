import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Field, Loading, PasswordInput, formatDate, initials } from "../components/ui.jsx";

/**
 * "Who logs in, and what is each of them here to do?"
 *
 * The people and their roles. Only HR can create an account or change
 * somebody's role; everyone else reads the list.
 */
export default function Team() {
  const { user } = useAuth();
  const canManage = Boolean(user?.permissions?.["team:manage"]);

  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "interviewer",
    jobTitle: "",
    password: "",
    contactEmail: "",
  });
  // HR editing one person's real email: which card, and what is typed.
  const [editingContact, setEditingContact] = useState(null);
  const [contactDraft, setContactDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.team();
      setMembers(result.members);
      setRoles(result.roles);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addMember(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.addMember(form);
      setMessage(form.name + " can now sign in.");
      setForm({ name: "", email: "", role: "interviewer", jobTitle: "", password: "", contactEmail: "" });
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(id, role) {
    setBusy(true);
    setError("");
    try {
      await api.updateMember(id, { role });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveContact(member) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.updateMember(member.id, { contactEmail: contactDraft });
      setMessage(
        contactDraft.trim()
          ? member.name + "'s email now goes to " + contactDraft.trim() + "."
          : member.name + "'s email goes to the company inbox again."
      );
      setEditingContact(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(member) {
    const turningOff = member.isActive;
    if (turningOff && !window.confirm("Deactivate " + member.name + "? They will not be able to sign in.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.updateMember(member.id, { isActive: !member.isActive });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const update = (key) => (event) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  if (loading) return <Loading what="the team" />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Who logs in</h1>
          <p className="subtitle">
            HR, hiring managers, interviewers and management. Candidates do not have accounts — HR
            adds them and uploads their CV.
          </p>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setShowAdd((c) => !c)}>
            {showAdd ? "Cancel" : "+ Add a person"}
          </button>
        )}
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>
      <Alert kind="success" onDismiss={() => setMessage("")}>
        {message}
      </Alert>

      {showAdd && (
        <div className="card mb-2">
          <h2>Add a person</h2>
          <p className="field-hint">
            There is no public sign-up: every account is created here, which is how a company
            controls who can see candidate data.
          </p>

          <form onSubmit={addMember} className="mt-2">
            <div className="grid grid-2">
              <Field label="Full name" htmlFor="name">
                <input
                  id="name"
                  className="input"
                  required
                  minLength={2}
                  value={form.name}
                  onChange={update("name")}
                />
              </Field>
              <Field label="Sign-in email" htmlFor="email">
                <input
                  id="email"
                  className="input"
                  type="email"
                  required
                  value={form.email}
                  onChange={update("email")}
                />
              </Field>
              <Field label="Role" htmlFor="role">
                <select id="role" className="select" value={form.role} onChange={update("role")}>
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Job title" htmlFor="jobTitle">
                <input
                  id="jobTitle"
                  className="input"
                  placeholder="Senior Software Engineer"
                  value={form.jobTitle}
                  onChange={update("jobTitle")}
                />
              </Field>
              <Field
                label="Real email (optional)"
                htmlFor="contactEmail"
                hint="The inbox they actually read. Reset links and interview invitations go here."
              >
                <input
                  id="contactEmail"
                  className="input"
                  type="email"
                  placeholder="name@gmail.com"
                  value={form.contactEmail}
                  onChange={update("contactEmail")}
                />
              </Field>
            </div>

            <Field
              label="Temporary password"
              htmlFor="password"
              hint="At least 8 characters with a letter and a number. They can change it from their profile."
            >
              <PasswordInput
                id="password"
                minLength={8}
                autoComplete="new-password"
                value={form.password}
                onChange={update("password")}
              />
            </Field>

            <p className="field-hint">{roles.find((r) => r.value === form.role)?.description}</p>

            <button className="btn btn-primary mt-2" disabled={busy}>
              Create account
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-2">
        {members.map((member) => (
          <div className="card" key={member.id} style={{ opacity: member.isActive ? 1 : 0.6 }}>
            <div className="row-between">
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                {member.avatarUrl ? (
                  <img className="avatar" src={member.avatarUrl} alt="" />
                ) : (
                  <span className="avatar">{initials(member.name)}</span>
                )}
                <div>
                  <h3>{member.name}</h3>
                  <div className="role-tag">{member.roleLabel}</div>
                </div>
              </div>
              {!member.isActive && <span className="badge badge-grey">Deactivated</span>}
            </div>

            <p className="mt-2 small muted">{member.roleDescription}</p>

            <div className="detail-grid mt-3">
              <div>
                <div className="detail-label">Signs in as</div>
                <div className="detail-value small">{member.email}</div>
              </div>
              {member.mailGoesTo !== undefined && (
                <div>
                  <div className="detail-label">Email goes to</div>
                  <div className="detail-value small">
                    {member.mailGoesTo}
                    {!member.contactEmail && member.mailGoesTo !== member.email && (
                      <span className="muted"> (company inbox)</span>
                    )}
                  </div>
                </div>
              )}
              <div>
                <div className="detail-label">Vacancies opened</div>
                <div className="detail-value">{member.vacanciesOpened}</div>
              </div>
              <div>
                <div className="detail-label">Interviews</div>
                <div className="detail-value">{member.interviewsBooked}</div>
              </div>
              <div>
                <div className="detail-label">Feedback given</div>
                <div className="detail-value">{member.feedbackGiven}</div>
              </div>
              <div>
                <div className="detail-label">Joined</div>
                <div className="detail-value small">{formatDate(member.createdAt)}</div>
              </div>
            </div>

            {canManage && editingContact === member.id && (
              <form
                className="contact-edit mt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveContact(member);
                }}
              >
                <label className="field-label" htmlFor={"contact-" + member.id}>
                  Real email for {member.name}
                </label>
                <div className="input-with-button">
                  <input
                    id={"contact-" + member.id}
                    className="input"
                    type="email"
                    placeholder="Leave empty for the company inbox"
                    value={contactDraft}
                    onChange={(event) => setContactDraft(event.target.value)}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" disabled={busy}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditingContact(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {canManage && (
              <div className="btn-row mt-3">
                <select
                  className="select"
                  style={{ width: "auto" }}
                  value={member.role}
                  onChange={(event) => changeRole(member.id, event.target.value)}
                  disabled={busy}
                  aria-label={"Role for " + member.name}
                >
                  {roles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => toggleActive(member)}
                  disabled={busy}
                >
                  {member.isActive ? "Deactivate" : "Reactivate"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditingContact(member.id);
                    setContactDraft(member.contactEmail || "");
                  }}
                  disabled={busy}
                >
                  {member.contactEmail ? "Change real email" : "Add real email"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

    </div>
  );
}
