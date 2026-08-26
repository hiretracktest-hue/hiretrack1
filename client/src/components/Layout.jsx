import { useCallback, useEffect, useState } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
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
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  // On a phone there is no room for seven links, so they collapse
  // behind a button. On a wide screen the button is hidden and the
  // links are always shown - see the media query in styles.css.
  const [menuOpen, setMenuOpen] = useState(false);

  const links = LINKS.filter((link) => !link.need || user?.permissions?.[link.need]);

  // Every role has a bell, and every role sees a different list in it -
  // the API only ever returns the notifications addressed to this user.
  const loadNotifications = useCallback(() => {
    return api
      .notifications()
      .then((result) => {
        setNotifications(result.notifications);
        setUnread(result.unread);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadNotifications();
    // Re-check every half minute so a booking or a verdict shows up
    // without the person having to reload the page.
    const timer = setInterval(loadNotifications, 30000);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  // Clicking anywhere else closes the panel.
  useEffect(() => {
    if (!bellOpen) return undefined;
    const close = (event) => {
      if (!event.target.closest?.(".bell")) setBellOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [bellOpen]);

  // Following a link should close the menu behind you.
  const location = useLocation();
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  async function markAllRead() {
    await api.markAllNotificationsRead().catch(() => {});
    await loadNotifications();
  }

  async function handleSignOut() {
    await signOut();
    navigate("/signin", { replace: true });
  }

  return (
    <div className="app">
      <header className="navbar">
        <div className="navbar-inner">
          <Link to="/dashboard" className="brand">
            <span className="brand-mark">AL</span>
            Altrium
          </Link>

          <button
            type="button"
            className="nav-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon open={menuOpen} />
          </button>

          <nav className={"nav-links" + (menuOpen ? " is-open" : "")}>
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="nav-user">
            <div className="bell">
              <button
                type="button"
                className="bell-button"
                aria-label={unread > 0 ? unread + " unread notifications" : "Notifications"}
                aria-expanded={bellOpen}
                onClick={() => setBellOpen((open) => !open)}
              >
                <BellIcon />
                {unread > 0 && <span className="nav-dot">{unread}</span>}
              </button>

              {bellOpen && (
                <div className="bell-panel">
                  <div className="bell-head">
                    <strong>Notifications</strong>
                    {unread > 0 && (
                      <button className="btn btn-ghost btn-sm" onClick={markAllRead}>
                        Mark all read
                      </button>
                    )}
                  </div>

                  {notifications.length === 0 ? (
                    <p className="bell-empty">
                      Nothing yet. You are told here when something needs you.
                    </p>
                  ) : (
                    <ul className="bell-list">
                      {notifications.slice(0, 8).map((note) => (
                        <li key={note.id} className={note.readAt ? "" : "is-unread"}>
                          {note.candidateId ? (
                            <Link
                              to={"/candidates/" + note.candidateId}
                              onClick={() => setBellOpen(false)}
                            >
                              {note.subject}
                            </Link>
                          ) : (
                            <span className="bell-subject">{note.subject}</span>
                          )}
                          <span className="bell-body">{note.body}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

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
        Altrium — recruitment &amp; hiring tracker. Group project by Isuru, Fazl, Thariq and Ahmed.
      </footer>
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3a6 6 0 0 0-6 6v3.6l-1.3 2.6A.8.8 0 0 0 5.4 16h13.2a.8.8 0 0 0 .7-1.2L18 12.6V9a6 6 0 0 0-6-6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** Three lines that become a cross. Animated, unless the viewer has
 *  asked their system for less motion. */
function MenuIcon({ open }) {
  return (
    <span className={"burger" + (open ? " is-open" : "")} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
