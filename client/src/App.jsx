import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";
import Layout from "./components/Layout.jsx";
import { Loading } from "./components/ui.jsx";

import SignIn from "./pages/SignIn.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Jobs from "./pages/Jobs.jsx";
import JobDetail from "./pages/JobDetail.jsx";
import JobEditor from "./pages/JobEditor.jsx";
import Compare from "./pages/Compare.jsx";
import Candidates from "./pages/Candidates.jsx";
import CandidateDetail from "./pages/CandidateDetail.jsx";
import Interviews from "./pages/Interviews.jsx";
import Outbox from "./pages/Outbox.jsx";
import Reports from "./pages/Reports.jsx";
import Team from "./pages/Team.jsx";
import Profile from "./pages/Profile.jsx";

/** Signed in? If not, go to /signin and remember where they were going. */
function Protected({ children, need }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading what="Altrium" />;
  if (!user) return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  // The API checks the same rule again on every request, so this is
  // convenience for the user, not the security boundary.
  if (need && !user.permissions?.[need]) return <Navigate to="/dashboard" replace />;
  return <Layout>{children}</Layout>;
}

/** Signed-in users should not see the sign-in screen again. */
function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading what="Altrium" />;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/signin"
        element={
          <PublicOnly>
            <SignIn />
          </PublicOnly>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <PublicOnly>
            <ForgotPassword />
          </PublicOnly>
        }
      />
      {/* Reachable signed out or in - the link arrives by email. */}
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route
        path="/dashboard"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />

      {/* --- open positions ------------------------------------------- */}
      <Route
        path="/positions"
        element={
          <Protected need="position:view">
            <Jobs />
          </Protected>
        }
      />
      <Route
        path="/positions/new"
        element={
          <Protected need="position:create">
            <JobEditor mode="create" />
          </Protected>
        }
      />
      <Route
        path="/positions/:id"
        element={
          <Protected need="position:view">
            <JobDetail />
          </Protected>
        }
      />
      <Route
        path="/positions/:id/edit"
        element={
          <Protected need="position:edit">
            <JobEditor mode="edit" />
          </Protected>
        }
      />
      <Route
        path="/positions/:id/compare"
        element={
          <Protected need="candidate:compare">
            <Compare />
          </Protected>
        }
      />

      {/* --- candidates ------------------------------------------------ */}
      <Route
        path="/candidates"
        element={
          <Protected need="candidate:view">
            <Candidates />
          </Protected>
        }
      />
      <Route
        path="/candidates/:id"
        element={
          <Protected need="candidate:view">
            <CandidateDetail />
          </Protected>
        }
      />

      {/* --- interviews, notifications, reports, people ---------------- */}
      <Route
        path="/interviews"
        element={
          <Protected need="interview:view">
            <Interviews />
          </Protected>
        }
      />
      <Route
        path="/outbox"
        element={
          <Protected need="outbox:view">
            <Outbox />
          </Protected>
        }
      />
      <Route
        path="/reports"
        element={
          <Protected need="report:view">
            <Reports />
          </Protected>
        }
      />
      <Route
        path="/team"
        element={
          <Protected need="team:view">
            <Team />
          </Protected>
        }
      />
      <Route
        path="/profile"
        element={
          <Protected>
            <Profile />
          </Protected>
        }
      />

      {/* Old vacancy addresses still work. */}
      <Route path="/jobs" element={<Navigate to="/positions" replace />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
