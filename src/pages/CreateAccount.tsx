import { AlertCircle, CheckCircle, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { BetaApplicationService, type InviteVerification } from '../features/beta-applications/beta-application-service';

function formatInviteError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value || '');
  if (!message || /supabase|database|fetch|jwt|token|typeerror|referenceerror/i.test(message)) {
    return 'This invitation could not be verified.';
  }
  return message;
}

export function CreateAccountPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [invite, setInvite] = useState<InviteVerification | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { user, signIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    BetaApplicationService.verifyInvite(token)
      .then((response) => {
        if (!mounted) return;
        setInvite(response.application);
        setDisplayName(response.application.fullName);
      })
      .catch((nextError) => {
        if (mounted) setError(formatInviteError(nextError));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [token]);

  if (user) return <Navigate to="/dashboard" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!invite) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      if (password.length < 12) throw new Error('Password must be at least 12 characters.');
      if (password !== confirmPassword) throw new Error('Passwords do not match.');
      await BetaApplicationService.register({ token, displayName: displayName.trim() || invite.fullName, password });
      setMessage('Account created. Opening your workspace...');
      await signIn(invite.email, password);
      navigate('/dashboard', { replace: true });
    } catch (nextError) {
      setError(formatInviteError(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel auth-panel-wide" aria-label="Create Atlaix account">
        <div className="auth-brand">
          <img src="/logo.png" alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          <strong>Atlaix</strong>
        </div>
        <p>Private Beta access</p>

        {loading ? (
          <div className="auth-message">
            <Lock size={17} />
            <span>Checking invitation...</span>
          </div>
        ) : invite ? (
          <form className="auth-form" onSubmit={submit}>
            <h1>Create account</h1>
            <p className="auth-context">Your invite is approved for {invite.email}.</p>

            <label>
              <span>Display name</span>
              <input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={invite.email} readOnly />
            </label>
            <label>
              <span>Password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <label>
              <span>Confirm password</span>
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
            </label>

            {error ? (
              <div className="auth-message error">
                <AlertCircle size={17} />
                <span>{error}</span>
              </div>
            ) : null}
            {message ? (
              <div className="auth-message success">
                <CheckCircle size={17} />
                <span>{message}</span>
              </div>
            ) : null}

            <button type="submit" className="auth-primary" disabled={submitting}>
              {submitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        ) : (
          <>
            <div className="auth-message error">
              <AlertCircle size={17} />
              <span>{error || 'This invitation is invalid or expired.'}</span>
            </div>
            <div className="auth-links">
              <a href="https://atlaix.com/early-access">Apply for Early Access</a>
              <Link to="/login">Already invited? Sign in</Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
