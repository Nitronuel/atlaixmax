import { Check, Copy, Mail, RefreshCw, Trash2, UserCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BetaApplicationService, type BetaApplication, type BetaApplicationStatus } from './beta-application-service';

const statusTabs: Array<BetaApplicationStatus | 'all'> = ['pending', 'approved', 'rejected', 'registered', 'all'];

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function statusLabel(status: BetaApplicationStatus | 'all') {
  return status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1);
}

export function BetaApplicationsAdminPage() {
  const [status, setStatus] = useState<BetaApplicationStatus | 'all'>('all');
  const [applications, setApplications] = useState<BetaApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualInviteUrl, setManualInviteUrl] = useState<string | null>(null);

  const counts = useMemo(() => applications.reduce<Record<string, number>>((total, application) => {
    total[application.status] = (total[application.status] || 0) + 1;
    return total;
  }, {}), [applications]);

  const filteredApplications = useMemo(() => (
    status === 'all'
      ? applications
      : applications.filter((application) => application.status === status)
  ), [applications, status]);

  async function loadApplications() {
    setLoading(true);
    setError(null);
    try {
      const response = await BetaApplicationService.listApplications('all');
      setApplications(response.applications);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Applications could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadApplications();
  }, []);

  async function runAction(application: BetaApplication, action: 'approve' | 'reject' | 'resend' | 'delete') {
    if (action === 'delete' && !window.confirm(`Delete ${application.fullName}'s beta application? This cannot be undone.`)) return;

    setWorkingId(application.id);
    setError(null);
    setMessage(null);
    setManualInviteUrl(null);
    try {
      if (action === 'reject') {
        await BetaApplicationService.reject(application.id);
        setMessage('Application rejected.');
      } else if (action === 'delete') {
        await BetaApplicationService.delete(application.id);
        setApplications((current) => current.filter((item) => item.id !== application.id));
        setMessage('Application deleted.');
        return;
      } else {
        const response = action === 'approve'
          ? await BetaApplicationService.approve(application.id)
          : await BetaApplicationService.resend(application.id);
        setManualInviteUrl(response.inviteUrl);
        setMessage(response.email.sent ? 'Invitation email sent.' : 'Invite created. Copy the link and send it manually.');
      }
      await loadApplications();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Action failed.');
    } finally {
      setWorkingId(null);
    }
  }

  async function copyInviteUrl() {
    if (!manualInviteUrl) return;
    await navigator.clipboard.writeText(manualInviteUrl);
    setMessage('Invite link copied.');
  }

  return (
    <section className="admin-page">
      <div className="admin-head">
        <div>
          <small>Admin</small>
          <h2>Private Beta Applications</h2>
          <p>Review early access requests, approve invited users, and track registration status.</p>
        </div>
        <button type="button" className="admin-icon-button" onClick={() => void loadApplications()} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Application status">
        {statusTabs.map((tab) => (
          <button
            type="button"
            key={tab}
            className={status === tab ? 'active' : ''}
            onClick={() => setStatus(tab)}
          >
            <span>{statusLabel(tab)}</span>
            {tab !== 'all' ? <em>{counts[tab] || 0}</em> : null}
          </button>
        ))}
      </div>

      {(message || error || manualInviteUrl) && (
        <div className={error ? 'admin-notice is-error' : 'admin-notice'}>
          <span>{error || message}</span>
          {manualInviteUrl ? (
            <button type="button" onClick={() => void copyInviteUrl()}>
              <Copy size={15} />
              <span>Copy invite link</span>
            </button>
          ) : null}
        </div>
      )}

      <div className="admin-table">
        <div className="admin-row admin-row-head">
          <span>Applicant</span>
          <span>Contact</span>
          <span>Use case</span>
          <span>Status</span>
          <span>Submitted</span>
          <span>Actions</span>
        </div>
        {loading ? (
          <div className="admin-empty">Loading applications...</div>
        ) : filteredApplications.length ? filteredApplications.map((application) => (
          <div className="admin-row" key={application.id}>
            <div>
              <strong>{application.fullName}</strong>
              <small>{application.email}</small>
            </div>
            <div>
              <span>{application.xUsername || 'No X username'}</span>
              <small>{application.telegramUsername || 'No Telegram username'}</small>
            </div>
            <p>{application.intendedUse || 'No use case provided.'}</p>
            <span className={`admin-status is-${application.status}`}>{statusLabel(application.status)}</span>
            <span>{formatDate(application.createdAt)}</span>
            <div className="admin-actions">
              {application.status !== 'registered' && application.status !== 'approved' ? (
                <button type="button" onClick={() => void runAction(application, 'approve')} disabled={workingId === application.id}>
                  <UserCheck size={15} />
                  <span>Approve</span>
                </button>
              ) : null}
              {application.status === 'approved' ? (
                <button type="button" onClick={() => void runAction(application, 'resend')} disabled={workingId === application.id}>
                  <Mail size={15} />
                  <span>Resend</span>
                </button>
              ) : null}
              {application.status !== 'registered' && application.status !== 'rejected' ? (
                <button type="button" className="danger" onClick={() => void runAction(application, 'reject')} disabled={workingId === application.id}>
                  <X size={15} />
                  <span>Reject</span>
                </button>
              ) : null}
              {application.status === 'registered' ? <Check size={18} /> : null}
              <button type="button" className="danger" onClick={() => void runAction(application, 'delete')} disabled={workingId === application.id}>
                <Trash2 size={15} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        )) : (
          <div className="admin-empty">No applications in this view.</div>
        )}
      </div>
    </section>
  );
}
