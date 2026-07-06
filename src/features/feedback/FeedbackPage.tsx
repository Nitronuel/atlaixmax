import { AlertCircle, CheckCircle, Inbox, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FeedbackService, type FeedbackMessage, type FeedbackThread } from './feedback-service';

const categories = ['Bug', 'Feature request', 'Account', 'Wallet tracking', 'Alerts', 'Other'];

function formatDate(value: string | null | undefined) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function statusLabel(status: string) {
  return status.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function messageAuthor(message: FeedbackMessage) {
  return message.sender_role === 'admin' ? 'Atlaix Support' : 'You';
}

export function FeedbackPage() {
  const { user, profile } = useAuth();
  const [threads, setThreads] = useState<FeedbackThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<FeedbackThread | null>(null);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [replying, setReplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sortedThreads = useMemo(() => [...threads].sort((left, right) => (
    new Date(right.last_message_at).getTime() - new Date(left.last_message_at).getTime()
  )), [threads]);

  async function loadThreads(selectId?: string) {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const response = await FeedbackService.listThreads();
      setThreads(response.threads);
      const nextId = selectId || selectedThread?.id || response.threads[0]?.id;
      if (nextId) {
        const detail = await FeedbackService.getThread(nextId);
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
  }, [user]);

  async function openThread(thread: FeedbackThread) {
    setError(null);
    try {
      const response = await FeedbackService.getThread(thread.id);
      setSelectedThread(response.thread);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Thread could not be opened.');
    }
  }

  async function submitFeedback(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) {
      setError('Write a message before sending feedback.');
      return;
    }
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const response = await FeedbackService.createThread({
        subject: subject.trim() || 'Feedback',
        category,
        message,
        sourcePath: typeof window === 'undefined' ? null : window.location.pathname,
        userName: profile?.display_name || user?.email?.split('@')[0] || null
      });
      setThreads((current) => [response.thread, ...current.filter((thread) => thread.id !== response.thread.id)]);
      setSelectedThread(response.thread);
      setSubject('');
      setCategory(categories[0]);
      setMessage('');
      setNotice('Feedback sent to Atlaix Support.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Feedback could not be sent.');
    } finally {
      setSaving(false);
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedThread || !reply.trim()) return;
    setReplying(true);
    setNotice(null);
    setError(null);
    try {
      const response = await FeedbackService.reply(selectedThread.id, reply);
      setSelectedThread(response.thread);
      setThreads((current) => [response.thread, ...current.filter((thread) => thread.id !== response.thread.id)]);
      setReply('');
      setNotice('Reply sent to Atlaix Support.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Reply could not be sent.');
    } finally {
      setReplying(false);
    }
  }

  return (
    <section className="feedback-page">
      <div className="feedback-head">
        <div>
          <small>Support</small>
          <h2>Feedback</h2>
          <p>Send product feedback, report issues, and continue the conversation with Atlaix Support.</p>
        </div>
        <button type="button" onClick={() => void loadThreads()} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {(notice || error) && (
        <div className={error ? 'feedback-notice is-error' : 'feedback-notice'}>
          {error ? <AlertCircle size={17} /> : <CheckCircle size={17} />}
          <span>{error || notice}</span>
        </div>
      )}

      <div className="feedback-layout">
        <form className="feedback-form" onSubmit={submitFeedback}>
          <div>
            <small>New message</small>
            <h3>Send feedback</h3>
          </div>
          <label>
            <span>Subject</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What should we look at?" maxLength={140} />
          </label>
          <label>
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span>Message</span>
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Share the issue, request, or context." maxLength={5000} />
          </label>
          <button type="submit" disabled={saving}>
            <Send size={16} />
            <span>{saving ? 'Sending...' : 'Send feedback'}</span>
          </button>
        </form>

        <div className="feedback-inbox">
          <aside className="feedback-thread-list" aria-label="Feedback conversations">
            <div className="feedback-thread-list-head">
              <Inbox size={17} />
              <strong>Conversations</strong>
            </div>
            {loading ? (
              <div className="feedback-empty">Loading conversations...</div>
            ) : sortedThreads.length ? sortedThreads.map((thread) => (
              <button
                type="button"
                key={thread.id}
                className={selectedThread?.id === thread.id ? 'active' : ''}
                onClick={() => void openThread(thread)}
              >
                <strong>{thread.subject}</strong>
                <span>{thread.category} · {statusLabel(thread.status)}</span>
                <time>{formatDate(thread.last_message_at)}</time>
              </button>
            )) : (
              <div className="feedback-empty">No feedback threads yet.</div>
            )}
          </aside>

          <section className="feedback-chat" aria-label="Selected feedback conversation">
            {selectedThread ? (
              <>
                <header>
                  <div>
                    <small>{selectedThread.category}</small>
                    <h3>{selectedThread.subject}</h3>
                    <p>{statusLabel(selectedThread.status)} · Last update {formatDate(selectedThread.last_message_at)}</p>
                  </div>
                  <span className={`feedback-status is-${selectedThread.status}`}>{statusLabel(selectedThread.status)}</span>
                </header>

                <div className="feedback-messages">
                  {(selectedThread.messages || []).map((item) => (
                    <article className={`feedback-message is-${item.sender_role}`} key={item.id}>
                      <div>
                        <strong>{messageAuthor(item)}</strong>
                        <time>{formatDate(item.created_at)}</time>
                      </div>
                      <p>{item.message}</p>
                      {item.email_error ? <small>Email notice: {item.email_error}</small> : null}
                    </article>
                  ))}
                </div>

                <form className="feedback-reply" onSubmit={submitReply}>
                  <label>
                    <span className="sr-only">Reply</span>
                    <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to Atlaix Support" maxLength={5000} />
                  </label>
                  <button type="submit" disabled={replying || !reply.trim()}>
                    <MessageSquare size={16} />
                    <span>{replying ? 'Sending...' : 'Send reply'}</span>
                  </button>
                </form>
              </>
            ) : (
              <div className="feedback-chat-empty">
                <MessageSquare size={24} />
                <strong>Select a conversation</strong>
                <span>New feedback threads will appear here after you send them.</span>
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
