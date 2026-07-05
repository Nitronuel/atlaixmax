import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import { ComingSoonPage } from './app/ComingSoonPage';
import { Layout } from './app/Layout';
import { AdminRoute, ProtectedRoute } from './components/auth/ProtectedRoute';
import { APP_CONFIG } from './config';
import { AuthProvider } from './contexts/AuthContext';
import { AiAssistantPage } from './features/ai-assistant/AiAssistantPage';
import { BetaApplicationsAdminPage } from './features/beta-applications/BetaApplicationsAdminPage';
import { CoinDetailsPage } from './features/coin-details/CoinDetailsPage';
import { DetectionPage } from './features/detection/DetectionPage';
import { DetectionTokenPage } from './features/detection/DetectionTokenPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { SafeScanPage } from './features/safe-scan/SafeScanPage';
import { SmartMoneyPage } from './features/smart-money/SmartMoneyPage';
import { SmartAlerts } from './features/smart-alerts/SmartAlertsPage';
import { TokenDetailsPage } from './features/token-details/TokenDetailsPage';
import { WalletTrackerPage } from './features/wallet-tracker/WalletTrackerPage';
import { WatchlistPage } from './features/watchlist/WatchlistPage';
import { AuthScreen } from './pages/Auth';
import { CreateAccountPage } from './pages/CreateAccount';
import { ProfileSettings } from './pages/ProfileSettings';

function EarlyAccessRedirect() {
  useEffect(() => {
    window.location.replace(`${APP_CONFIG.marketingBaseUrl}/early-access`);
  }, []);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/auth" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<AuthScreen initialMode="login" />} />
        <Route path="/signup" element={APP_CONFIG.authMode === 'public' ? <AuthScreen initialMode="signup" /> : <EarlyAccessRedirect />} />
        <Route path="/create-account" element={<CreateAccountPage />} />
        <Route path="/reset-password" element={<AuthScreen initialMode="reset" />} />
        <Route
          path="/*"
          element={(
            <Layout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<OverviewPage />} />
                <Route path="/coin/:coinId" element={<CoinDetailsPage />} />
                <Route path="/token/:address" element={<TokenDetailsPage />} />
                <Route path="/detection/token/:chain/:address" element={<DetectionTokenPage />} />
                <Route path="/detection/*" element={<DetectionPage />} />
                <Route path="/sentiment" element={<ComingSoonPage title="Narrative Intelligence" />} />
                <Route path="/smart-money" element={<SmartMoneyPage />} />
                <Route path="/smart-money/:address" element={<SmartMoneyPage />} />
                <Route path="/safe-scan" element={<SafeScanPage />} />
                <Route path="/wallet" element={<WalletTrackerPage />} />
                <Route path="/wallet/:address" element={<WalletTrackerPage />} />
                <Route path="/smart-alerts" element={<SmartAlerts />} />
                <Route path="/watchlist" element={<WatchlistPage />} />
                <Route path="/ai-assistant" element={<AiAssistantPage />} />
                <Route path="/admin/beta-applications" element={<AdminRoute><BetaApplicationsAdminPage /></AdminRoute>} />
                <Route path="/settings" element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />
                <Route path="*" element={<ComingSoonPage title="Page not found" />} />
              </Routes>
            </Layout>
          )}
        />
      </Routes>
    </AuthProvider>
  );
}
