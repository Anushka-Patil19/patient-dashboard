import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import { Alert, Spinner } from './components/ui.jsx';
import { LiveUpdatesProvider } from './hooks/useLiveUpdates.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';
import EncounterFormPage from './pages/EncounterFormPage.jsx';
import EncountersPage from './pages/EncountersPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import PatientsPage from './pages/PatientsPage.jsx';
import UsersPage from './pages/UsersPage.jsx';

// Charts are the heaviest dependency; load them only for roles that see the dashboard.
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));

/** UI-level guard for a friendlier experience; the API enforces the same rules. */
function RequirePermission({ permission, children }) {
  const { can } = useAuth();
  const allowed = [].concat(permission).some(can);
  if (!allowed) {
    return (
      <Alert tone="error" title="You don't have access to this page">
        Your role does not include this function. Contact your administrator if you need access.
      </Alert>
    );
  }
  return children;
}

function HomeRedirect() {
  const { can } = useAuth();
  if (can('analytics:read')) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/encounters/new" replace />;
}

export default function App() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Checking session" />
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
      </Routes>
    );
  }

  return (
    <LiveUpdatesProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="login" element={<HomeRedirect />} />
          <Route path="dashboard" element={<RequirePermission permission="analytics:read"><Suspense fallback={<Spinner />}><DashboardPage /></Suspense></RequirePermission>} />
          <Route path="encounters" element={<RequirePermission permission="encounter:read:own"><EncountersPage /></RequirePermission>} />
          <Route path="encounters/new" element={<RequirePermission permission="encounter:create"><EncounterFormPage /></RequirePermission>} />
          <Route path="encounters/:id" element={<RequirePermission permission="encounter:read:own"><EncounterFormPage /></RequirePermission>} />
          <Route path="patients" element={<RequirePermission permission="patient:read"><PatientsPage /></RequirePermission>} />
          <Route path="audit" element={<RequirePermission permission="audit:read"><AuditLogPage /></RequirePermission>} />
          <Route path="users" element={<RequirePermission permission="user:manage"><UsersPage /></RequirePermission>} />
          <Route path="*" element={<Alert tone="warn" title="Page not found" />} />
        </Route>
      </Routes>
    </LiveUpdatesProvider>
  );
}
