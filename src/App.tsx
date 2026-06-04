import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './app/Layout';
import { SafeScanPage } from './features/safe-scan/SafeScanPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/safe-scan" replace />} />
        <Route path="/safe-scan" element={<SafeScanPage />} />
        <Route path="*" element={<Navigate to="/safe-scan" replace />} />
      </Routes>
    </Layout>
  );
}
