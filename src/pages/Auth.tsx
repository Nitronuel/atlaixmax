import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Check, CheckCircle, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

type AuthMode = 'login' | 'reset';

interface AuthScreenProps {
  initialMode?: AuthMode;
}

const REMEMBERED_EMAIL_KEY = 'atlaix-remembered-email';

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
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const rememberedEmail = window.localStorage.getItem(REMEMBERED_EMAIL_KEY);
      if (rememberedEmail) {
        setEmail(rememberedEmail);
        setRemember(true);
      }
    } catch {
      // Remembered email is optional.
    }
  }, []);

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
      try {
        if (remember) {
          window.localStorage.setItem(REMEMBERED_EMAIL_KEY, trimmedEmail);
        } else {
          window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
        }
      } catch {
        // Sign-in should not fail if local storage is unavailable.
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'login' ? 'Welcome back' : 'Reset password';
  const buttonText = mode === 'login' ? 'Sign in' : 'Send reset email';

  return (
    <main className="auth-page">
      <section className="auth-panel" aria-label={title}>
        <div className="auth-brand">
          <img src="/logo.png" alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          <strong>Atlaix</strong>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <h1>{title}{mode === 'login' ? '!' : ''}</h1>
          <p className="auth-form-subtitle">
            {mode === 'login' ? 'Sign in to access your Atlaix account' : 'Enter your email to receive a reset link'}
          </p>

          <label>
            <span>Email</span>
            <div className="auth-input-wrap">
              <Mail size={23} />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete={remember ? 'email' : 'off'}
                placeholder="Enter your email"
              />
            </div>
          </label>

          {mode !== 'reset' && (
            <label>
              <span>Password</span>
              <div className="auth-input-wrap">
                <Lock size={23} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={remember ? 'current-password' : 'off'}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={23} /> : <Eye size={23} />}
                </button>
              </div>
            </label>
          )}

          {mode !== 'reset' ? (
            <div className="auth-form-options">
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => {
                    setRemember(event.target.checked);
                    if (!event.target.checked) {
                      try {
                        window.localStorage.removeItem(REMEMBERED_EMAIL_KEY);
                      } catch {
                        // Remembered email is optional.
                      }
                    }
                  }}
                />
                <span className="auth-checkbox" aria-hidden="true">{remember ? <Check size={14} /> : null}</span>
                <span>Remember me</span>
              </label>
              <button type="button" onClick={() => setMode('reset')}>Forgot password?</button>
            </div>
          ) : null}

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
          {mode === 'reset' ? (
            <button type="button" onClick={() => setMode('login')}>Back to login</button>
          ) : (
            <>
              <span>Don't have an account?</span>
              <Link to="/early-access">Sign up</Link>
            </>
          )}
        </div>

        <p className="auth-security-note">
          <Lock size={17} />
          <span>Secure and encrypted. Your data is safe with us.</span>
        </p>
      </section>
    </main>
  );
}
