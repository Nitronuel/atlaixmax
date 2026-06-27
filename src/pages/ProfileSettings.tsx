import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Bell, CheckCircle, ExternalLink, Link2, LogOut, Mail, RefreshCw, Save, Send, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { TelegramService, type TelegramLink, type TelegramStatus } from '../services/TelegramService';
import { SmartAlertService, type SmartAlertRule } from '../features/smart-alerts/smart-alert-service';

const formatSettingsError = (value: unknown, fallback = 'Could not update account settings.') => {
  const message = value instanceof Error ? value.message : String(value || '');
  if (!message) return fallback;
  if (/supabase|api|provider|configured|configuration|network|fetch|server|database|endpoint|schema/i.test(message)) return fallback;
  return message;
};

export function ProfileSettings() {
  const { user, profile, profileError, updateProfile, resetPassword, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [saving, setSaving] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramLink, setTelegramLink] = useState<TelegramLink | null>(null);
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [alertRules, setAlertRules] = useState<SmartAlertRule[]>([]);
  const [alertRulesLoading, setAlertRulesLoading] = useState(false);
  const [telegramChannelSaving, setTelegramChannelSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const telegramChannelEnabled = alertRules.some((rule) => rule.notification_channels.includes('telegram'));

  useEffect(() => {
    setDisplayName(profile?.display_name || '');
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

  const refreshAlertRules = useCallback(async () => {
    if (!user) return;
    setAlertRulesLoading(true);
    try {
      const rules = await SmartAlertService.listRules();
      setAlertRules(rules);
    } catch (err) {
      setError(formatSettingsError(err, 'Could not load alert channel settings.'));
    } finally {
      setAlertRulesLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshAlertRules();
  }, [refreshAlertRules]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await updateProfile({
        display_name: displayName.trim() || user?.email?.split('@')[0] || 'Atlaix User'
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

  const handleTelegramChannelToggle = async () => {
    if (!telegramStatus?.connected || !alertRules.length) return;
    setTelegramChannelSaving(true);
    setMessage(null);
    setError(null);
    try {
      const enableTelegram = !telegramChannelEnabled;
      const nextRules = await Promise.all(alertRules.map((rule) => {
        const currentChannels = rule.notification_channels.length ? rule.notification_channels : ['in_app'];
        const nextChannels = enableTelegram
          ? Array.from(new Set([...currentChannels, 'telegram']))
          : currentChannels.filter((channel) => channel !== 'telegram');
        return SmartAlertService.setRuleNotificationChannels(rule.id, nextChannels.length ? nextChannels : ['in_app']);
      }));
      setAlertRules(nextRules);
      setMessage(enableTelegram ? 'Telegram alerts turned on.' : 'Telegram alerts turned off.');
    } catch (err) {
      setError(formatSettingsError(err, 'Could not update Telegram alert delivery.'));
    } finally {
      setTelegramChannelSaving(false);
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
          <div className="settings-telegram-heading">
            <small>Notifications</small>
            <h3>Alert channels</h3>
            <p>Choose where Smart Alerts should reach you.</p>
          </div>

          <div className="settings-channel-list" aria-label="Alert channels">
            <Link className="settings-channel-row is-action" to="/smart-alerts" aria-label="Manage in-app notification rules">
              <span className="settings-channel-icon"><Bell size={16} /></span>
              <span>In-app notifications</span>
              <strong>On</strong>
              <ArrowRight className="settings-channel-arrow" size={15} />
            </Link>
            <button className="settings-channel-row is-action" type="button" onClick={() => setTelegramModalOpen(true)}>
              <span className="settings-channel-icon"><Send size={16} /></span>
              <span>Telegram bot</span>
              <strong className={telegramChannelEnabled && telegramStatus?.connected ? '' : 'is-muted'}>{telegramChannelEnabled && telegramStatus?.connected ? 'On' : 'Off'}</strong>
              <ArrowRight className="settings-channel-arrow" size={15} />
            </button>
            <button className="settings-channel-row is-disabled" type="button" disabled>
              <span className="settings-channel-icon"><Mail size={16} /></span>
              <span>Email alerts</span>
              <strong>Planned</strong>
              <ArrowRight className="settings-channel-arrow" size={15} />
            </button>
            <button className="settings-channel-row is-disabled" type="button" disabled>
              <span className="settings-channel-icon"><Link2 size={16} /></span>
              <span>Webhook</span>
              <strong>Planned</strong>
              <ArrowRight className="settings-channel-arrow" size={15} />
            </button>
          </div>
        </div>
      </div>

      {telegramModalOpen && (
        <div className="settings-modal-backdrop" role="presentation" onMouseDown={() => setTelegramModalOpen(false)}>
          <div className="settings-channel-modal" role="dialog" aria-modal="true" aria-labelledby="telegram-channel-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <small>Alert channel</small>
                <h3 id="telegram-channel-title">Telegram bot</h3>
              </div>
              <button className="settings-modal-close" type="button" onClick={() => setTelegramModalOpen(false)} aria-label="Close Telegram settings">
                <X size={18} />
              </button>
            </header>

            <div className="settings-channel-account">
              <span className="settings-channel-icon"><Send size={18} /></span>
              <div>
                <strong>{telegramStatus?.connected ? (telegramStatus.telegramUsername || 'Telegram connected') : 'No Telegram account connected'}</strong>
                <p>{telegramStatus?.connected ? 'This account can receive Telegram delivery for saved Smart Alerts.' : 'Connect Telegram before turning this channel on.'}</p>
              </div>
            </div>

            <div className="settings-channel-toggle-row">
              <div>
                <strong>Telegram alert delivery</strong>
                <p>{alertRules.length ? `${alertRules.length} saved alert ${alertRules.length === 1 ? 'rule' : 'rules'}` : 'Create an alert rule before this switch can change delivery.'}</p>
              </div>
              <button
                className={`settings-channel-switch ${telegramChannelEnabled && telegramStatus?.connected ? 'is-on' : ''}`}
                type="button"
                role="switch"
                aria-checked={telegramChannelEnabled && telegramStatus?.connected}
                disabled={!telegramStatus?.connected || !alertRules.length || telegramChannelSaving || alertRulesLoading}
                onClick={handleTelegramChannelToggle}
              >
                <span>{telegramChannelSaving ? 'Saving' : telegramChannelEnabled && telegramStatus?.connected ? 'On' : 'Off'}</span>
              </button>
            </div>

            <div className="settings-channel-modal-actions">
              <button type="button" onClick={handleTelegramConnect} disabled={telegramLoading || !user}>
                <Send size={16} />
                <span>{telegramLoading ? 'Working...' : telegramStatus?.connected ? 'Change account' : 'Connect Telegram'}</span>
              </button>
              <button type="button" onClick={refreshTelegramStatus} disabled={telegramLoading || !user}>
                <RefreshCw size={16} />
                <span>Refresh status</span>
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
      )}
    </section>
  );
}
