import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

type AuthMode = 'login' | 'reset';

interface AuthScreenProps {
  initialMode?: AuthMode;
}

const formatAuthError = (value: unknown, fallback = 'Authentication could not complete. Please try again.') => {
  const message = value instanceof Error ? value.message : String(value || '');
  if (!message) return fallback;
  console.warn('[Auth] Sign-in flow error', value);
  if (/invalid login|invalid credentials|email.*password|password.*email/i.test(message)) return 'Email or password is incorrect.';
  if (/already registered|already exists|user already/i.test(message)) return 'An account already exists for this email.';
  if (/rate limit|too many|over email send rate/i.test(message)) return 'Too many attempts. Please wait a moment and try again.';
  if (/quota|setitem|storage|localstorage|sessionstorage/i.test(message)) return 'We could not finish signing you in on this browser. Refresh the page and try again.';
  if (/supabase|api|provider|configured|configuration|network|fetch|server|database|endpoint|auth-token|jwt|token/i.test(message)) return fallback;
  if (message.length > 120 || /['"`{}()[\]]|failed to execute|typeerror|referenceerror|syntaxerror/i.test(message)) return fallback;
  return message;
};

export function AuthScreen({ initialMode = 'login' }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user, loading, profileError, signIn, resetPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/dashboard';

  useEffect(() => {
    setMode(initialMode);
    setMessage(null);
    setError(null);
  }, [initialMode]);

  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) throw new Error('Enter your email address.');

      if (mode === 'reset') {
        await resetPassword(trimmedEmail);
        setMessage('Password reset email sent. Check your inbox.');
        return;
      }

      if (password.length < 12) throw new Error('Password must be at least 12 characters.');

      await signIn(trimmedEmail, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'login' ? 'Welcome back' : 'Reset password';
  const buttonText = mode === 'login' ? 'Log in' : 'Send reset email';

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-label={title}>
        <div className="auth-brand">
          <img src="/logo.png" alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          <strong>Atlaix</strong>
        </div>
        <p>Anticipating trends ahead of the market.</p>

        <div className="auth-tabs single" role="tablist" aria-label="Account access">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Sign in
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <h1>{title}{mode === 'login' ? '!' : ''}</h1>

          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>

          {mode !== 'reset' && (
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
          )}

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

          <button type="submit" className="auth-primary" disabled={submitting}>
            {submitting ? 'Working...' : buttonText}
          </button>
        </form>

        <div className="auth-links">
          {mode !== 'reset' ? (
            <button type="button" onClick={() => setMode('reset')}>Forgot password?</button>
          ) : (
            <button type="button" onClick={() => setMode('login')}>Back to login</button>
          )}

          {mode === 'login' ? <Link to="/early-access">Apply for Early Access</Link> : null}
        </div>
      </section>
    </main>
  );
}
