import { Navigate, Route, Routes } from 'react-router-dom';
import { ComingSoonPage } from './app/ComingSoonPage';
import { Layout } from './app/Layout';
import { AiAssistantPage } from './features/ai-assistant/AiAssistantPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { SafeScanPage } from './features/safe-scan/SafeScanPage';
import { SmartMoneyPage } from './features/smart-money/SmartMoneyPage';
import { SmartAlerts } from './features/smart-alerts/SmartAlertsPage';
import { TokenDetailsPage } from './features/token-details/TokenDetailsPage';
import { WalletTrackerPage } from './features/wallet-tracker/WalletTrackerPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<OverviewPage />} />
        <Route path="/token/:address" element={<TokenDetailsPage />} />
        <Route path="/detection/*" element={<ComingSoonPage title="Detection Engine" />} />
        <Route path="/sentiment" element={<ComingSoonPage title="Narrative Intelligence" />} />
        <Route path="/smart-money" element={<SmartMoneyPage />} />
        <Route path="/smart-money/:address" element={<SmartMoneyPage />} />
        <Route path="/heatmap" element={<ComingSoonPage title="Token Heatmap" />} />
        <Route path="/safe-scan" element={<SafeScanPage />} />
        <Route path="/wallet" element={<WalletTrackerPage />} />
        <Route path="/wallet/:address" element={<WalletTrackerPage />} />
        <Route path="/smart-alerts" element={<SmartAlerts />} />
        <Route path="/ai-assistant" element={<AiAssistantPage />} />
        <Route path="/settings" element={<ComingSoonPage title="Settings" />} />
        <Route path="*" element={<ComingSoonPage title="Page not found" />} />
      </Routes>
    </Layout>
  );
}
