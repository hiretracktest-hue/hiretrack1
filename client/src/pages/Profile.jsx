import { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Field, PasswordInput, formatDate, initials } from "../components/ui.jsx";

const TEAM_ROLES = [
  { value: "developer", label: "Developer" },
  { value: "scrum_master", label: "Scrum Master" },
  { value: "business_analyst", label: "Business Analyst" },
  { value: "qa", label: "QA Engineer" },
];
const CLIENT_ROLES = [{ value: "client", label: "Client" }];

export default function Profile() {
  const { user, setUser } = useAuth();

  const [profile, setProfile] = useState({ name: user?.name || "", role: user?.role || "client" });
  // A client cannot promote themselves onto the hiring team.
  const roles = user?.isStaff ? TEAM_ROLES : CLIENT_ROLES;
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const result = await api.updateProfile(profile);
      setUser(result.user);
      setMessage("Profile updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (passwords.newPassword !== passwords.confirm) {
      setError("The two new passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await api.changePassword({
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      });
      setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
      setMessage("Password changed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Your profile</h1>
          <p className="subtitle">Update your name, your project role, and your password.</p>
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>
      <Alert kind="success" onDismiss={() => setMessage("")}>
        {message}
      </Alert>

      <div className="grid grid-2">
        <div className="card">
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            {user?.avatarUrl ? (
              <img className="avatar" src={user.avatarUrl} alt="" />
            ) : (
              <span className="avatar">{initials(user?.name)}</span>
            )}
            <div>
              <h2>{user?.name}</h2>
              <div className="cell-sub">
                {user?.email} · joined {formatDate(user?.createdAt)}
              </div>
            </div>
          </div>

          <form onSubmit={saveProfile} className="mt-3">
            <Field label="Full name" htmlFor="name">
              <input
                id="name"
                className="input"
                required
                minLength={2}
                value={profile.name}
                onChange={(event) => setProfile((c) => ({ ...c, name: event.target.value }))}
              />
            </Field>

            <Field
              label="Project role"
              htmlFor="role"
              hint={
                user?.isStaff
                  ? "A label for the report - all four hiring team roles can do exactly the same things."
                  : "Clients apply for jobs and follow their own application."
              }
            >
              <select
                id="role"
                className="select"
                value={profile.role}
                onChange={(event) => setProfile((c) => ({ ...c, role: event.target.value }))}
              >
                {roles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </Field>

            <button className="btn btn-primary" disabled={busy}>
              Save profile
            </button>
          </form>
        </div>

        <div className="card">
          <h2>Change password</h2>
          {user?.signedInWithGoogle && (
            <p className="field-hint mt-1">
              You signed in with Google. Setting a password here lets you also sign in with your
              email address.
            </p>
          )}

          <form onSubmit={savePassword} className="mt-2">
            <Field label="Current password" htmlFor="currentPassword">
              <PasswordInput
                id="currentPassword"
                autoComplete="current-password"
                placeholder="Leave empty if you only use Google"
                required={false}
                value={passwords.currentPassword}
                onChange={(event) =>
                  setPasswords((c) => ({ ...c, currentPassword: event.target.value }))
                }
              />
            </Field>

            <Field
              label="New password"
              htmlFor="newPassword"
              hint="At least 8 characters, with one letter and one number."
            >
              <PasswordInput
                id="newPassword"
                autoComplete="new-password"
                value={passwords.newPassword}
                onChange={(event) => setPasswords((c) => ({ ...c, newPassword: event.target.value }))}
              />
            </Field>

            <Field label="Confirm new password" htmlFor="confirmPassword">
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                placeholder="Type it again"
                value={passwords.confirm}
                onChange={(event) => setPasswords((c) => ({ ...c, confirm: event.target.value }))}
              />
            </Field>

            <button className="btn btn-primary" disabled={busy}>
              Change password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
