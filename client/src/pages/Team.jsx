import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Alert, Loading, formatDate, initials } from "../components/ui.jsx";

/**
 * Our group: four people, four roles, one access level. This page is
 * mostly for the report - it shows who is on the project and what each
 * person is responsible for.
 */
const RESPONSIBILITIES = {
  developer: "Builds the React front end and the Express/SQL back end.",
  scrum_master: "Runs the sprints, stand-ups and the sprint board.",
  business_analyst: "Gathers requirements and writes the user stories.",
  qa: "Writes the test cases and verifies each story before it is done.",
};

export default function Team() {
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .team()
      .then((result) => {
        setMembers(result.members);
        setRoles(result.roles);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading what="the team" />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Project team</h1>
          <p className="subtitle">
            Everyone here has the same access to the system — the role is how we split the
            coursework, not a permission level.
          </p>
        </div>
      </div>

      <Alert kind="error" onDismiss={() => setError("")}>
        {error}
      </Alert>

      <div className="grid grid-2">
        {members.map((member) => (
          <div className="card" key={member.id}>
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
              {member.signedInWithGoogle && <span className="badge badge-blue">Google account</span>}
            </div>

            <p className="mt-2 small muted">{RESPONSIBILITIES[member.role] || ""}</p>

            <div className="detail-grid mt-3">
              <div>
                <div className="detail-label">Email</div>
                <div className="detail-value small">{member.email}</div>
              </div>
              <div>
                <div className="detail-label">Vacancies posted</div>
                <div className="detail-value">{member.jobsCreated}</div>
              </div>
              <div>
                <div className="detail-label">Joined</div>
                <div className="detail-value small">{formatDate(member.createdAt)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card mt-3">
        <h2>Access model</h2>
        <p className="mt-1 small muted">
          The <code>users.role</code> column stores one of{" "}
          {roles.map((role) => role.value).join(", ")}. The API checks that a request comes from a
          signed-in user, but never checks which role that user has, so all four of us can create
          vacancies, review candidates, upload CVs and schedule interviews.
        </p>
      </div>
    </div>
  );
}
