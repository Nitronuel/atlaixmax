import { Inbox, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { BetaApplicationsAdminPage } from '../beta-applications/BetaApplicationsAdminPage';
import { FeedbackService, type FeedbackMessage, type FeedbackStatus, type FeedbackThread } from '../feedback/feedback-service';

type AdminTab = 'feedback' | 'applications';

const statusOptions: FeedbackStatus[] = ['open', 'waiting_admin', 'waiting_user', 'resolved'];

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function statusLabel(status: string) {
  return status.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function messageAuthor(message: FeedbackMessage, thread: FeedbackThread) {
  return message.sender_role === 'admin' ? 'Atlaix Support' : `${thread.user_name} - ${thread.user_email}`;
}

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('feedback');

  return (
    <section className="admin-page">
      <div className="admin-head">
        <div>
          <small>Admin</small>
          <h2>Admin</h2>
          <p>Review user feedback, reply to support threads, and manage private beta applications.</p>
        </div>
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        <button type="button" className={tab === 'feedback' ? 'active' : ''} onClick={() => setTab('feedback')}>
          <span>Feedback</span>
        </button>
        <button type="button" className={tab === 'applications' ? 'active' : ''} onClick={() => setTab('applications')}>
          <span>Applications</span>
        </button>
      </div>

      {tab === 'feedback' ? <AdminFeedbackPanel /> : <BetaApplicationsAdminPage />}
    </section>
  );
}

function AdminFeedbackPanel() {
  const [threads, setThreads] = useState<FeedbackThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<FeedbackThread | null>(null);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [replying, setReplying] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedThreads = useMemo(() => [...threads].sort((left, right) => (
    new Date(right.last_message_at).getTime() - new Date(left.last_message_at).getTime()
  )), [threads]);

  const counts = useMemo(() => threads.reduce<Record<string, number>>((total, thread) => {
    total[thread.status] = (total[thread.status] || 0) + 1;
    return total;
  }, {}), [threads]);

  async function loadThreads(selectId?: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await FeedbackService.listAdminThreads();
      setThreads(response.threads);
      const nextId = selectId || selectedThread?.id || response.threads[0]?.id;
      if (nextId) {
        const detail = await FeedbackService.getAdminThread(nextId);
        setSelectedThread(detail.thread);
      } else {
        setSelectedThread(null);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Feedback could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadThreads();
  }, []);

  async function openThread(thread: FeedbackThread) {
    setError(null);
    try {
      const response = await FeedbackService.getAdminThread(thread.id);
      setSelectedThread(response.thread);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Thread could not be opened.');
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedThread || !reply.trim()) return;
    setReplying(true);
    setNotice(null);
    setError(null);
    try {
      const response = await FeedbackService.replyAsAdmin(selectedThread.id, reply);
      setSelectedThread(response.thread);
      setThreads((current) => [response.thread, ...current.filter((thread) => thread.id !== response.thread.id)]);
      setReply('');
      setNotice('Reply saved and emailed to the user.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Reply could not be sent.');
    } finally {
      setReplying(false);
    }
  }

  async function updateStatus(status: FeedbackStatus) {
    if (!selectedThread) return;
    setStatusSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await FeedbackService.updateStatus(selectedThread.id, status);
      const nextThread = { ...selectedThread, ...response.thread };
      setSelectedThread(nextThread);
      setThreads((current) => current.map((thread) => thread.id === nextThread.id ? nextThread : thread));
      setNotice('Thread status updated.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Status could not be updated.');
    } finally {
      setStatusSaving(false);
    }
  }

  return (
    <div className="admin-feedback-panel">
      <div className="admin-feedback-toolbar">
        <div>
          <Inbox size={18} />
          <strong>Feedback inbox</strong>
          <span>{counts.waiting_admin || 0} waiting for admin</span>
        </div>
        <button type="button" className="admin-icon-button" onClick={() => void loadThreads()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {(notice || error) && (
        <div className={error ? 'admin-notice is-error' : 'admin-notice'}>
          <span>{error || notice}</span>
        </div>
      )}

      <div className="admin-feedback-layout">
        <aside className="admin-feedback-list" aria-label="Feedback threads">
          {loading ? (
            <div className="admin-empty">Loading feedback...</div>
          ) : sortedThreads.length ? sortedThreads.map((thread) => (
            <button
              type="button"
              key={thread.id}
              className={selectedThread?.id === thread.id ? 'active' : ''}
              onClick={() => void openThread(thread)}
            >
              <strong>{thread.subject}</strong>
              <span>{thread.user_name} - {thread.user_email}</span>
              <small>{thread.category} - {statusLabel(thread.status)}</small>
              <time>{formatDate(thread.last_message_at)}</time>
            </button>
          )) : (
            <div className="admin-empty">No feedback yet.</div>
          )}
        </aside>

        <section className="admin-feedback-chat" aria-label="Feedback conversation">
          {selectedThread ? (
            <>
              <header>
                <div>
                  <small>{selectedThread.category}</small>
                  <h3>{selectedThread.subject}</h3>
                  <p>{selectedThread.user_name} - {selectedThread.user_email}</p>
                  <p>Source: {selectedThread.source_path || 'Not provided'} - Last update {formatDate(selectedThread.last_message_at)}</p>
                </div>
                <label>
                  <span className="sr-only">Thread status</span>
                  <select value={selectedThread.status} disabled={statusSaving} onChange={(event) => void updateStatus(event.target.value as FeedbackStatus)}>
                    {statusOptions.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
                  </select>
                </label>
              </header>

              <div className="feedback-messages">
                {(selectedThread.messages || []).map((item) => (
                  <article className={`feedback-message is-${item.sender_role}`} key={item.id}>
                    <div>
                      <strong>{messageAuthor(item, selectedThread)}</strong>
                      <time>{formatDate(item.created_at)}</time>
                    </div>
                    <p>{item.message}</p>
                    {item.email_error ? <small>Email notice: {item.email_error}</small> : null}
                  </article>
                ))}
              </div>

              <form className="feedback-reply" onSubmit={sendReply}>
                <label>
                  <span className="sr-only">Admin reply</span>
                  <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to the user" maxLength={5000} />
                </label>
                <button type="submit" disabled={replying || !reply.trim()}>
                  <Send size={16} />
                  <span>{replying ? 'Sending...' : 'Send reply'}</span>
                </button>
              </form>
            </>
          ) : (
            <div className="feedback-chat-empty">
              <MessageSquare size={24} />
              <strong>Select a thread</strong>
              <span>User feedback appears here after submission.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
