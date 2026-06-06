import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './app/Layout';
import { OverviewPage } from './features/overview/OverviewPage';
import { SafeScanPage } from './features/safe-scan/SafeScanPage';
import { TokenDetailsPage } from './features/token-details/TokenDetailsPage';
import { WalletTrackerPage } from './features/wallet-tracker/WalletTrackerPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<OverviewPage />} />
        <Route path="/token/:address" element={<TokenDetailsPage />} />
        <Route path="/safe-scan" element={<SafeScanPage />} />
        <Route path="/wallet" element={<WalletTrackerPage />} />
        <Route path="/wallet/:address" element={<WalletTrackerPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}
