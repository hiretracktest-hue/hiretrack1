import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { api } from "../api.js";
import { initials } from "./ui.jsx";
import {
  IconBell,
  IconBriefcase,
  IconCalendar,
  IconChart,
  IconDashboard,
  IconLogout,
  IconMail,
  IconSearch,
  IconShield,
  IconTeam,
  IconUsers,
} from "./icons.jsx";

/**
 * "Who logs in, and what can each role see and do?" - the menu is built
 * from the permissions the server sent with the user, so an interviewer
 * never sees a page they cannot use. A group with nothing in it for this
 * person is left out altogether.
 */
const GROUPS = [
  {
    label: "Workspace",
    links: [
      { to: "/dashboard", label: "Dashboard", icon: IconDashboard },
      { to: "/vacancies", label: "Vacancies", icon: IconBriefcase, need: "position:view" },
      { to: "/candidates", label: "Candidates", icon: IconUsers, need: "candidate:view" },
      { to: "/interviews", label: "Interviews", icon: IconCalendar, need: "interview:view" },
      { to: "/outbox", label: "Outbox", icon: IconMail, need: "outbox:view" },
    ],
  },
  {
    label: "Insights",
    links: [
      { to: "/reports", label: "Reports", icon: IconChart, need: "report:view" },
      { to: "/audit", label: "Audit log", icon: IconShield, need: "audit:view" },
    ],
  },
  {
    label: "Organisation",
    links: [{ to: "/team", label: "Team", icon: IconTeam, need: "team:view" }],
  },
];

// The name of the section in the top bar, from the first part of the path.
const SECTION = {
  dashboard: "Dashboard",
  vacancies: "Vacancies",
  candidates: "Candidates",
  interviews: "Interviews",
  outbox: "Outbox",
  reports: "Reports",
  audit: "Audit log",
  team: "Team",
  profile: "Your profile",
};

export default function Layout({ children }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  // On a wide screen the sidebar is always there. On a phone or tablet
  // it slides in over the page from the menu button.
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);

  const can = (need) => !need || user?.permissions?.[need];
  const groups = GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => can(link.need)),
  })).filter((group) => group.links.length > 0);

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

  // Following a link closes the menu behind you.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Ctrl+K (Cmd+K on a Mac) jumps to the search box from anywhere, and
  // Escape closes whatever is open.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setMenuOpen(false);
        setBellOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function markAllRead() {
    await api.markAllNotificationsRead().catch(() => {});
    await loadNotifications();
  }

  async function handleSignOut() {
    await signOut();
    navigate("/signin", { replace: true });
  }

  // The search lands on the Candidates page with what was typed. It goes
  // as navigation state as well as ?q=, so the page can tell a new search
  // from its own address-bar updates while someone is typing there.
  function search(event) {
    event.preventDefault();
    const term = query.trim();
    navigate("/candidates" + (term ? "?q=" + encodeURIComponent(term) : ""), {
      state: { search: term, at: Date.now() },
    });
    setQuery("");
    searchRef.current?.blur();
  }

  const section = SECTION[location.pathname.split("/")[1]] || "Altrium";
  const year = new Date().getFullYear();

  return (
    <div className={"shell" + (menuOpen ? " menu-open" : "")} data-role={user?.role}>
      {/* The first thing a keyboard reaches: straight past the menu. */}
      <a className="skip-link" href="#content">
        Skip to content
      </a>

      <aside className="sidebar" aria-label="Main menu">
        <div className="sidebar-head">
          <Link to="/dashboard" className="brand brand-on-dark">
            <span className="brand-mark">AL</span>
            <span className="brand-text">
              <strong>Altrium</strong>
              <span>Recruitment</span>
            </span>
          </Link>
        </div>

        <nav className="side-nav">
          {groups.map((group) => (
            <div className="side-group" key={group.label}>
              <div className="side-group-label">{group.label}</div>
              {group.links.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => "side-link" + (isActive ? " active" : "")}
                >
                  <Icon />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <Link to="/profile" className="side-user" title="Your profile">
            {user?.avatarUrl ? (
              <img className="avatar" src={user.avatarUrl} alt="" />
            ) : (
              <span className="avatar">{initials(user?.name)}</span>
            )}
            <span className="side-user-meta">
              <strong>{user?.name}</strong>
              <span>{user?.roleLabel || user?.role}</span>
            </span>
          </Link>
          <button type="button" className="side-signout" onClick={handleSignOut}>
            <IconLogout size={17} />
            Sign out
          </button>
          <p className="sidebar-legal">© {year} Altrium. All rights reserved.</p>
        </div>
      </aside>

      {/* Tapping the dimmed page closes the menu on a phone. */}
      <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="nav-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MenuIcon open={menuOpen} />
          </button>

          <div className="topbar-title">
            <span className="crumb">Altrium</span>
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
            <span>{section}</span>
          </div>

          {can("candidate:view") && (
            <form className="topbar-search" role="search" onSubmit={search}>
              <IconSearch size={16} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search candidates…"
                aria-label="Search candidates by name or email"
              />
              <kbd>Ctrl K</kbd>
            </form>
          )}

          <div className="topbar-actions">
            <div className="bell">
              <button
                type="button"
                className="bell-button"
                aria-label={unread > 0 ? unread + " unread notifications" : "Notifications"}
                aria-expanded={bellOpen}
                onClick={() => setBellOpen((open) => !open)}
              >
                <IconBell />
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

            <Link to="/profile" className="avatar topbar-avatar" title="Your profile">
              {user?.avatarUrl ? (
                <img className="avatar" src={user.avatarUrl} alt="" />
              ) : (
                initials(user?.name)
              )}
            </Link>
          </div>
        </header>

        <main className="content" id="content" tabIndex={-1}>
          {children}
        </main>

        {/* On a wide screen this line sits at the foot of the sidebar;
            on a phone the sidebar is tucked away, so it shows here. */}
        <footer className="footer">© {year} Altrium. All rights reserved.</footer>
      </div>
    </div>
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
