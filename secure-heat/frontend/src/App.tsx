import { Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import AppLayout from './layouts/AppLayout';
import Analytics from './pages/Analytics';
import { ForgotPassword, Login } from './pages/AuthPages';
import Events from './pages/Events';
import Monitoring from './pages/Monitoring';
import Overview from './pages/Overview';
import Quarantine from './pages/Quarantine';
import Sensors from './pages/Sensors';
import SettingsPage from './pages/Settings';
import Simulator from './pages/Simulator';
import { ROLES } from './utils/permissions';

export default function App() {
  const guard = (el: JSX.Element, roles?: readonly string[]) => <ProtectedRoute roles={roles as never}>{el}</ProtectedRoute>;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<Overview />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="sensors" element={<Sensors />} />
        <Route path="events" element={<Events />} />
        <Route path="quarantine" element={guard(<Quarantine />, ROLES.analystUp)} />
        <Route path="analytics" element={guard(<Analytics />, ROLES.analystUp)} />
        <Route path="simulator" element={guard(<Simulator />, ROLES.analystUp)} />
        <Route path="settings" element={guard(<SettingsPage />, ROLES.adminOnly)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
