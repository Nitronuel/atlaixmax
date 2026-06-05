import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './app/Layout';
import { OverviewPage } from './features/overview/OverviewPage';
import { SafeScanPage } from './features/safe-scan/SafeScanPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<OverviewPage />} />
        <Route path="/safe-scan" element={<SafeScanPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}
