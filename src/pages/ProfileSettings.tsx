import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, ExternalLink, LogOut, MessageCircle, RefreshCw, Save, Unlink } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { TelegramService, type TelegramLink, type TelegramStatus } from '../services/TelegramService';

const formatSettingsError = (value: unknown, fallback = 'Could not update account settings.') => {
  const message = value instanceof Error ? value.message : String(value || '');
  if (!message) return fallback;
  if (/supabase|api|provider|configured|configuration|network|fetch|server|database|endpoint|schema/i.test(message)) return fallback;
  return message;
};

export function ProfileSettings() {
  const { user, profile, profileError, updateProfile, resetPassword, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [preferredChain, setPreferredChain] = useState(profile?.preferred_chain || 'solana');
  const [saving, setSaving] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramLink, setTelegramLink] = useState<TelegramLink | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile?.display_name || '');
    setPreferredChain(profile?.preferred_chain || 'solana');
  }, [profile]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setTelegramLoading(true);
    TelegramService.getStatus()
      .then((status) => {
        if (!cancelled) setTelegramStatus(status);
      })
      .catch((err) => {
        if (!cancelled) setError(formatSettingsError(err, 'Could not load Telegram settings.'));
      })
      .finally(() => {
        if (!cancelled) setTelegramLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await updateProfile({
        display_name: displayName.trim() || user?.email?.split('@')[0] || 'Atlaix User',
        preferred_chain: preferredChain.trim() || 'solana'
      });
      setMessage('Profile updated.');
    } catch (err) {
      setError(formatSettingsError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!user?.email) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await resetPassword(user.email);
      setMessage('Password reset email sent.');
    } catch (err) {
      setError(formatSettingsError(err, 'Could not send password reset email.'));
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
  };

  const handleTelegramConnect = async () => {
    setTelegramLoading(true);
    setMessage(null);
    setError(null);
    try {
      const link = await TelegramService.createLink();
      setTelegramLink(link);
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(formatSettingsError(err, 'Could not create Telegram link.'));
    } finally {
      setTelegramLoading(false);
    }
  };

  const refreshTelegramStatus = async () => {
    setTelegramLoading(true);
    setError(null);
    try {
      const status = await TelegramService.getStatus();
      setTelegramStatus(status);
      setTelegramLink(null);
      setMessage(status.connected ? 'Telegram connected.' : 'Telegram is not connected yet.');
    } catch (err) {
      setError(formatSettingsError(err, 'Could not refresh Telegram settings.'));
    } finally {
      setTelegramLoading(false);
    }
  };

  const handleTelegramDisconnect = async () => {
    setTelegramLoading(true);
    setMessage(null);
    setError(null);
    try {
      await TelegramService.disconnect();
      setTelegramStatus((current) => current ? { ...current, connected: false, telegramUsername: null, connectedAt: null } : current);
      setTelegramLink(null);
      setMessage('Telegram disconnected.');
    } catch (err) {
      setError(formatSettingsError(err, 'Could not disconnect Telegram.'));
    } finally {
      setTelegramLoading(false);
    }
  };

  return (
    <section className="settings-page">
      <div className="settings-panel">
        <header>
          <div>
            <small>Account</small>
            <h2>Profile settings</h2>
          </div>
          <button type="button" onClick={handleLogout}>
            <LogOut size={17} />
            <span>Log out</span>
          </button>
        </header>

        <form onSubmit={handleSave}>
          <label>
            <span>Email</span>
            <input value={user?.email || ''} readOnly />
          </label>
          <label>
            <span>Display name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            <span>Preferred chain</span>
            <input value={preferredChain} onChange={(event) => setPreferredChain(event.target.value)} />
          </label>
          <div className="settings-meta">
            <span>Plan</span>
            <strong>{profile?.plan || 'free'}</strong>
          </div>
          <div className="settings-meta">
            <span>Role</span>
            <strong>{profile?.role || 'user'}</strong>
          </div>

          {(error || profileError) && (
            <div className="auth-message error">
              <AlertCircle size={17} />
              <span>{error || profileError}</span>
            </div>
          )}

          {message && (
            <div className="auth-message success">
              <CheckCircle size={17} />
              <span>{message}</span>
            </div>
          )}

          <div className="settings-actions">
            <button type="button" onClick={handleReset} disabled={saving || !user?.email}>
              <RefreshCw size={17} />
              <span>Send password reset</span>
            </button>
            <button type="submit" disabled={saving}>
              <Save size={17} />
              <span>{saving ? 'Saving...' : 'Save profile'}</span>
            </button>
          </div>
        </form>

        <div className="settings-telegram">
          <div>
            <small>Notifications</small>
            <h3>Telegram alerts</h3>
            <p>{telegramStatus?.connected ? `Connected${telegramStatus.telegramUsername ? ` as ${telegramStatus.telegramUsername}` : ''}.` : 'Connect Telegram to receive Smart Alerts from the bot.'}</p>
          </div>
          <div className="settings-telegram-actions">
            {telegramStatus?.connected ? (
              <button type="button" onClick={handleTelegramDisconnect} disabled={telegramLoading}>
                <Unlink size={17} />
                <span>{telegramLoading ? 'Working...' : 'Disconnect'}</span>
              </button>
            ) : (
              <button type="button" onClick={handleTelegramConnect} disabled={telegramLoading || !user}>
                <MessageCircle size={17} />
                <span>{telegramLoading ? 'Working...' : 'Connect Telegram'}</span>
              </button>
            )}
            <button type="button" onClick={refreshTelegramStatus} disabled={telegramLoading || !user}>
              <RefreshCw size={17} />
              <span>Refresh</span>
            </button>
          </div>
          {telegramLink && (
            <a className="settings-telegram-link" href={telegramLink.url} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              <span>Open @{telegramLink.botUsername}</span>
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
