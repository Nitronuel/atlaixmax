import { ArrowRight, CheckCircle, Mail, MessageSquare, Send, User, X } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { BetaApplicationService } from '../features/beta-applications/beta-application-service';

type EarlyAccessForm = {
  fullName: string;
  email: string;
  xUsername: string;
  telegramUsername: string;
  intendedUse: string;
};

type EarlyAccessErrors = Partial<Record<keyof EarlyAccessForm, string>>;

const initialForm: EarlyAccessForm = {
  fullName: '',
  email: '',
  xUsername: '',
  telegramUsername: '',
  intendedUse: ''
};

function isValidEmail(value: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function formatApplicationError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value || '');
  if (/valid email/i.test(message)) return 'Enter a valid email address.';
  if (/full name/i.test(message)) return 'Full name is required.';
  if (/temporarily unavailable|service role|supabase|database|fetch|network/i.test(message)) {
    return 'Early access requests are unavailable right now. Try again soon.';
  }
  return 'We could not submit your application. Try again soon.';
}

export function EarlyAccessPage() {
  const { user, loading } = useAuth();
  const [form, setForm] = useState<EarlyAccessForm>(initialForm);
  const [errors, setErrors] = useState<EarlyAccessErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/dashboard" replace />;

  function validate() {
    const nextErrors: EarlyAccessErrors = {};
    if (!form.fullName.trim()) nextErrors.fullName = 'Full name is required.';
    if (!form.email.trim()) nextErrors.email = 'Email address is required.';
    else if (!isValidEmail(form.email.trim())) nextErrors.email = 'Enter a valid email address.';
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function updateField(field: keyof EarlyAccessForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const nextErrors = { ...current };
      delete nextErrors[field];
      return nextErrors;
    });
    if (error) setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || submitted || !validate()) return;

    setSubmitting(true);
    setError(null);
    try {
      await BetaApplicationService.submitApplication({
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        xUsername: form.xUsername.trim() || undefined,
        telegramUsername: form.telegramUsername.trim() || undefined,
        intendedUse: form.intendedUse.trim() || undefined
      });
      setSubmitted(true);
    } catch (nextError) {
      setError(formatApplicationError(nextError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="early-access-page">
      <section className="early-access-shell" aria-label="Atlaix early access application">
        <div className="early-access-copy">
          <img className="early-access-mark" src="/logo.png" alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
          <h1>AI-Powered <span>Market Intelligence</span></h1>
          <p>
            Atlaix is available by invitation while we onboard a limited group of early users and refine the platform before public release.
          </p>
          <p className="early-access-signin">
            Already invited? <Link to="/login">Sign in</Link>
          </p>
        </div>

        <form className="early-access-form-panel" id="early-access-form" onSubmit={submit} noValidate>
          <h2>{submitted ? 'Application received' : 'Apply for Early Access'}</h2>
          <p>{submitted ? 'We will email your invite link if your request is approved.' : 'Tell us a bit about yourself'}</p>

          {submitted ? (
            <div className="early-access-success" role="status">
              <CheckCircle size={21} />
              <div>
                <strong>Thanks for your interest in Atlaix.</strong>
                <span>Your request is in review. Approved applicants receive an email with a private account creation link.</span>
              </div>
            </div>
          ) : (
            <>
              <label className="early-access-field">
                <span>Full Name</span>
                <div>
                  <User size={18} />
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(event) => updateField('fullName', event.target.value)}
                    autoComplete="name"
                    placeholder="Enter your full name"
                    aria-invalid={errors.fullName ? 'true' : 'false'}
                  />
                </div>
                {errors.fullName ? <small>{errors.fullName}</small> : null}
              </label>

              <label className="early-access-field">
                <span>Email Address</span>
                <div>
                  <Mail size={18} />
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => updateField('email', event.target.value)}
                    autoComplete="email"
                    placeholder="Enter your email address"
                    aria-invalid={errors.email ? 'true' : 'false'}
                  />
                </div>
                {errors.email ? <small>{errors.email}</small> : null}
              </label>

              <label className="early-access-field">
                <span>X Username <em>(Optional)</em></span>
                <div>
                  <X size={18} />
                  <input
                    type="text"
                    value={form.xUsername}
                    onChange={(event) => updateField('xUsername', event.target.value)}
                    autoComplete="off"
                    placeholder="Enter your X username"
                  />
                </div>
              </label>

              <label className="early-access-field">
                <span>Telegram Username <em>(Optional)</em></span>
                <div>
                  <Send size={18} />
                  <input
                    type="text"
                    value={form.telegramUsername}
                    onChange={(event) => updateField('telegramUsername', event.target.value)}
                    autoComplete="off"
                    placeholder="Enter your Telegram username"
                  />
                </div>
              </label>

              <label className="early-access-field">
                <span>How do you plan to use Atlaix? <em>(Optional)</em></span>
                <div className="is-textarea">
                  <MessageSquare size={18} />
                  <textarea
                    value={form.intendedUse}
                    onChange={(event) => updateField('intendedUse', event.target.value)}
                    rows={4}
                    placeholder="Tell us how you plan to use Atlaix"
                  />
                </div>
              </label>

              {error ? <div className="early-access-error" role="alert">{error}</div> : null}

              <button className="early-access-submit" type="submit" disabled={submitting}>
                <span>{submitting ? 'Submitting...' : 'Apply for Early Access'}</span>
                {!submitting ? <ArrowRight size={20} /> : null}
              </button>
            </>
          )}
        </form>
      </section>
    </main>
  );
}
