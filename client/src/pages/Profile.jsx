import { useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { Alert, Field, PasswordInput, formatDate, initials } from "../components/ui.jsx";

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_SIZE = 320;

/**
 * Cut a square out of the chosen picture and shrink it to 320px, as a
 * JPEG. A tall portrait is cut a little above the middle, where faces
 * are, rather than dead centre. Transparent parts of a PNG become white.
 */
async function squarePhoto(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("unreadable"));
      img.src = URL.createObjectURL(file);
    });
  }
  const side = Math.min(source.width, source.height);
  const sx = (source.width - side) / 2;
  const sy = (source.height - side) * 0.3;

  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  return canvas.toDataURL("image/jpeg", 0.88);
}

export default function Profile() {
  const { user, setUser } = useAuth();

  const [profile, setProfile] = useState({
    name: user?.name || "",
    jobTitle: user?.jobTitle || "",
    contactEmail: user?.contactEmail || "",
  });
  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const photoInput = useRef(null);

  async function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again still counts
    if (!file) return;
    setError("");
    setMessage("");
    if (!PHOTO_TYPES.includes(file.type)) {
      setError("Choose a JPG, PNG or WebP picture.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("That picture is over 15 MB. Choose a smaller one.");
      return;
    }
    setPhotoBusy(true);
    try {
      const image = await squarePhoto(file);
      const result = await api.uploadPhoto(image);
      setUser(result.user);
      setMessage("Photo updated. It now shows everywhere your name does.");
    } catch (err) {
      setError(
        err.message === "unreadable"
          ? "That picture could not be read. Choose a JPG, PNG or WebP."
          : err.message
      );
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setError("");
    setMessage("");
    setPhotoBusy(true);
    try {
      const result = await api.removePhoto();
      setUser(result.user);
      setMessage("Photo removed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const result = await api.updateProfile(profile);
      setUser(result.user);
      setProfile((c) => ({ ...c, contactEmail: result.user.contactEmail || "" }));
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
          <p className="subtitle">Your photo, your details, where your email goes, and your password.</p>
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
          <div className="profile-photo">
            <div className={"profile-photo-frame" + (photoBusy ? " is-busy" : "")}>
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={"Photo of " + user.name} />
              ) : (
                <span aria-hidden="true">{initials(user?.name)}</span>
              )}
              <button
                type="button"
                className="profile-photo-edit"
                onClick={() => photoInput.current?.click()}
                disabled={photoBusy}
                aria-label={user?.avatarUrl ? "Change your photo" : "Add a photo"}
              >
                <CameraIcon />
              </button>
            </div>

            <div className="profile-photo-meta">
              <h2>{user?.name}</h2>
              <div className="cell-sub">
                {user?.email} · joined {formatDate(user?.createdAt)}
              </div>
              <div className="btn-row mt-1">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => photoInput.current?.click()}
                  disabled={photoBusy}
                >
                  {photoBusy ? "Saving…" : user?.avatarUrl ? "Change photo" : "Upload a photo"}
                </button>
                {user?.avatarUrl && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={removePhoto}
                    disabled={photoBusy}
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="field-hint">JPG, PNG or WebP. It is cropped to a square.</p>
              <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={choosePhoto}
              />
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

            <Field label="Job title" htmlFor="jobTitle">
              <input
                id="jobTitle"
                className="input"
                placeholder="Senior Software Engineer"
                value={profile.jobTitle}
                onChange={(event) => setProfile((c) => ({ ...c, jobTitle: event.target.value }))}
              />
            </Field>

            <Field
              label="Real email"
              htmlFor="contactEmail"
              hint={
                "Password reset links and interview invitations go here. You still sign in as " +
                (user?.email || "before") +
                ". Right now your email goes to " +
                (user?.mailGoesTo || user?.email) +
                "."
              }
            >
              <input
                id="contactEmail"
                className="input"
                type="email"
                autoComplete="email"
                placeholder="you@gmail.com"
                value={profile.contactEmail}
                onChange={(event) => setProfile((c) => ({ ...c, contactEmail: event.target.value }))}
              />
            </Field>

            <Field label="Your role" hint="Only HR can change a role. Ask them if this is wrong.">
              <input className="input" value={user?.roleLabel || ""} disabled readOnly />
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
                minLength={8}
                value={passwords.newPassword}
                onChange={(event) => setPasswords((c) => ({ ...c, newPassword: event.target.value }))}
              />
            </Field>

            <Field label="Confirm new password" htmlFor="confirmPassword">
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                placeholder="Type it again"
                minLength={8}
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

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.2-1.8a1.5 1.5 0 0 1 1.2-.7h3a1.5 1.5 0 0 1 1.2.7L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </svg>
  );
}
