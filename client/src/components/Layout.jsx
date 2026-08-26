import { useEffect, useState } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { api } from "../api.js";
import { initials } from "./ui.jsx";

/**
 * "Who logs in, and what can each role see and do?" - the menu is built
 * from the permissions the server sent with the user, so an interviewer
 * never sees a page they cannot use.
 */
const LINKS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/positions", label: "Positions", need: "position:view" },
  { to: "/candidates", label: "Candidates", need: "candidate:view" },
  { to: "/interviews", label: "Interviews", need: "interview:view" },
  { to: "/outbox", label: "Outbox", need: "outbox:view" },
  { to: "/reports", label: "Reports", need: "report:view" },
  { to: "/team", label: "Team", need: "team:view" },
];

export default function Layout({ children }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  const links = LINKS.filter((link) => !link.need || user?.permissions?.[link.need]);

  // An interviewer is told about a new booking here.
  useEffect(() => {
    let cancelled = false;
    api
      .notifications()
      .then((result) => !cancelled && setUnread(result.unread))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    await signOut();
    navigate("/signin", { replace: true });
  }

  return (
    <div className="app">
      <header className="navbar">
        <div className="navbar-inner">
          <Link to="/dashboard" className="brand">
            <span className="brand-mark">HT</span>
            HireTrack
          </Link>

          <nav className="nav-links">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                {link.label}
                {link.to === "/interviews" && unread > 0 && (
                  <span className="nav-dot" title={unread + " new"}>
                    {unread}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="nav-user">
            <Link to="/profile" className="avatar" title="Your profile">
              {user?.avatarUrl ? (
                <img className="avatar" src={user.avatarUrl} alt="" />
              ) : (
                initials(user?.name)
              )}
            </Link>
            <div className="nav-user-meta">
              <strong>{user?.name}</strong>
              <span>{user?.roleLabel || user?.role}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      {children}

      <footer className="footer">
        HireTrack — recruitment &amp; hiring tracker. Group project by Isuru, Fazl, Thariq and Ahmed.
      </footer>
    </div>
  );
}
