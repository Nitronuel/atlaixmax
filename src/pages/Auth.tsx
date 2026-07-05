import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle, Mail } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { useAuth } from '../contexts/AuthContext';

type AuthMode = 'login' | 'signup' | 'reset';

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
  const publicSignupEnabled = APP_CONFIG.authMode === 'public';
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user, loading, profileError, signIn, signUp, resetPassword, signInWithGoogle } = useAuth();
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

      if (mode === 'signup') {
        if (!publicSignupEnabled) throw new Error('Private Beta accounts require an invitation.');
        if (password !== confirmPassword) throw new Error('Passwords do not match.');
        const result = await signUp(trimmedEmail, password, displayName.trim());
        if (result.needsEmailConfirmation) {
          setMessage('Account created. Check your email to confirm your login.');
        } else {
          navigate('/dashboard', { replace: true });
        }
        return;
      }

      await signIn(trimmedEmail, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(formatAuthError(err, 'Google sign-in could not start. Please try again.'));
      setSubmitting(false);
    }
  };

  const title = mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create account' : 'Reset password';
  const buttonText = mode === 'login' ? 'Log in' : mode === 'signup' ? 'Create account' : 'Send reset email';

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-label={title}>
        <div className="auth-brand">
          <img src="/logo.png" alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          <strong>Atlaix</strong>
        </div>
        <p>Anticipating trends ahead of the market.</p>

        <div className={`auth-tabs ${publicSignupEnabled ? '' : 'single'}`} role="tablist" aria-label="Account access">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Sign in
          </button>
          {publicSignupEnabled ? (
            <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>
              Create account
            </button>
          ) : null}
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <h1>{title}{mode === 'login' ? '!' : ''}</h1>

          {mode === 'signup' && (
            <label>
              <span>Display name</span>
              <input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
            </label>
          )}

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
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>
          )}

          {mode === 'signup' && (
            <label>
              <span>Confirm password</span>
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
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

          {mode !== 'reset' && publicSignupEnabled && (
            <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'login' ? 'Create account' : 'Sign in instead'}
            </button>
          )}
          {mode === 'login' && !publicSignupEnabled ? (
            <a href={`${APP_CONFIG.marketingBaseUrl}/early-access`}>Apply for Early Access</a>
          ) : null}
        </div>

        {mode !== 'reset' && (
          <button type="button" className="auth-google" onClick={handleGoogle} disabled={submitting}>
            <Mail size={20} />
            <span>Continue with Google</span>
          </button>
        )}
      </section>
    </main>
  );
}
