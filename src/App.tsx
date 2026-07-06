import { Navigate, Route, Routes } from 'react-router-dom';
import { ComingSoonPage } from './app/ComingSoonPage';
import { Layout } from './app/Layout';
import { AdminRoute, ProtectedRoute } from './components/auth/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { AdminPage } from './features/admin/AdminPage';
import { AiAssistantPage } from './features/ai-assistant/AiAssistantPage';
import { CoinDetailsPage } from './features/coin-details/CoinDetailsPage';
import { DetectionPage } from './features/detection/DetectionPage';
import { DetectionTokenPage } from './features/detection/DetectionTokenPage';
import { FeedbackPage } from './features/feedback/FeedbackPage';
import { OverviewPage } from './features/overview/OverviewPage';
import { SafeScanPage } from './features/safe-scan/SafeScanPage';
import { SmartMoneyPage } from './features/smart-money/SmartMoneyPage';
import { SmartAlerts } from './features/smart-alerts/SmartAlertsPage';
import { TokenDetailsPage } from './features/token-details/TokenDetailsPage';
import { WalletTrackerPage } from './features/wallet-tracker/WalletTrackerPage';
import { WatchlistPage } from './features/watchlist/WatchlistPage';
import { AuthScreen } from './pages/Auth';
import { CreateAccountPage } from './pages/CreateAccount';
import { EarlyAccessPage } from './pages/EarlyAccess';
import { ProfileSettings } from './pages/ProfileSettings';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/auth" element={<Navigate to="/login" replace />} />
        <Route path="/early-access" element={<EarlyAccessPage />} />
        <Route path="/login" element={<AuthScreen initialMode="login" />} />
        <Route path="/signup" element={<Navigate to="/early-access" replace />} />
        <Route path="/create-account" element={<CreateAccountPage />} />
        <Route path="/reset-password" element={<AuthScreen initialMode="reset" />} />
        <Route
          path="/*"
          element={(
            <ProtectedRoute>
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
                  <Route path="/feedback" element={<FeedbackPage />} />
                  <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
                  <Route path="/admin/beta-applications" element={<Navigate to="/admin" replace />} />
                  <Route path="/settings" element={<ProfileSettings />} />
                  <Route path="*" element={<ComingSoonPage title="Page not found" />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          )}
        />
      </Routes>
    </AuthProvider>
  );
}
