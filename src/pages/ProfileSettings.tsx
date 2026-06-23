import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, LogOut, RefreshCw, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile?.display_name || '');
    setPreferredChain(profile?.preferred_chain || 'solana');
  }, [profile]);

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
      </div>
    </section>
  );
}
