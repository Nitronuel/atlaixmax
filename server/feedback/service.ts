import type { AuthenticatedUser } from '../auth';
import { sendMail, supportEmail, type MailDelivery, type MailMessage } from '../mail/smtp';
import { FeedbackStore, type FeedbackStatus, type FeedbackThread, type FeedbackThreadWithMessages } from './store';

export type FeedbackMailer = (message: MailMessage) => Promise<MailDelivery>;

export type CreateFeedbackInput = {
  subject?: string;
  category?: string;
  message?: string;
  sourcePath?: string | null;
  userName?: string | null;
};

export type ReplyFeedbackInput = {
  message?: string;
};

const SUBJECT_MAX = 140;
const CATEGORY_MAX = 60;
const MESSAGE_MAX = 5000;
const SOURCE_PATH_MAX = 300;

function cleanText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function requireMessage(value: unknown) {
  const message = cleanText(value, MESSAGE_MAX);
  if (message.length < 3) throw new Error('Message must be at least 3 characters.');
  return message;
}

function normalizeSubject(value: unknown) {
  const subject = cleanText(value, SUBJECT_MAX);
  return subject || 'Feedback';
}

function normalizeCategory(value: unknown) {
  const category = cleanText(value, CATEGORY_MAX);
  return category || 'General';
}

function normalizeUserName(user: AuthenticatedUser, value: unknown) {
  const name = cleanText(value, 120);
  return name || user.email.split('@')[0] || 'Atlaix User';
}

function normalizeSourcePath(value: unknown) {
  const path = cleanText(value, SOURCE_PATH_MAX);
  return path || null;
}

function formatDate(value = new Date().toISOString()) {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function supportSubject(thread: FeedbackThread) {
  return `[Atlaix Feedback] ${thread.subject}`;
}

function userSubject(thread: FeedbackThread) {
  return `Atlaix Support replied: ${thread.subject}`;
}

function supportMessageText(thread: FeedbackThread, message: string, label: string) {
  return [
    label,
    '',
    `Subject: ${thread.subject}`,
    `Category: ${thread.category}`,
    `Status: ${thread.status}`,
    `Sender: ${thread.user_name} <${thread.user_email}>`,
    `User ID: ${thread.user_id}`,
    `Source page: ${thread.source_path || 'Not provided'}`,
    `Thread ID: ${thread.id}`,
    `Time: ${formatDate()}`,
    '',
    'Message:',
    message
  ].join('\n');
}

function userReplyText(thread: FeedbackThread, message: string) {
  return [
    `Hi ${thread.user_name || 'there'},`,
    '',
    'Atlaix Support replied to your feedback:',
    '',
    message,
    '',
    'You can continue the conversation from the Feedback page in Atlaix.',
    '',
    'Atlaix Support'
  ].join('\n');
}

export class FeedbackService {
  constructor(
    private readonly store = new FeedbackStore(),
    private readonly mailer: FeedbackMailer = sendMail
  ) {}

  private queueEmail(messageId: string, message: MailMessage) {
    void this.mailer(message)
      .then((delivery) => this.store.updateMessageEmail(messageId, delivery))
      .catch((error) => this.store.updateMessageEmail(messageId, {
        sent: false,
        reason: error instanceof Error ? error.message : 'Email could not be sent.'
      }))
      .catch((error) => {
        console.warn('[Feedback] Email status update failed.', error);
      });
  }

  async createThread(user: AuthenticatedUser, input: CreateFeedbackInput) {
    const thread = await this.store.createThread({
      userId: user.id,
      userEmail: user.email,
      userName: normalizeUserName(user, input.userName),
      subject: normalizeSubject(input.subject),
      category: normalizeCategory(input.category),
      sourcePath: normalizeSourcePath(input.sourcePath)
    });
    const message = await this.store.createMessage({
      threadId: thread.id,
      senderId: user.id,
      senderRole: 'user',
      senderEmail: user.email,
      message: requireMessage(input.message)
    });
    this.queueEmail(message.id, {
      to: supportEmail(),
      subject: supportSubject(thread),
      text: supportMessageText(thread, message.message, 'New Atlaix feedback'),
      replyTo: user.email
    });
    return this.getThreadForUser(thread.id, user.id);
  }

  async replyAsUser(user: AuthenticatedUser, threadId: string, input: ReplyFeedbackInput) {
    const thread = await this.getThreadForUser(threadId, user.id);
    const message = await this.store.createMessage({
      threadId: thread.id,
      senderId: user.id,
      senderRole: 'user',
      senderEmail: user.email,
      message: requireMessage(input.message)
    });
    this.queueEmail(message.id, {
      to: supportEmail(),
      subject: supportSubject(thread),
      text: supportMessageText(thread, message.message, 'User replied to Atlaix feedback'),
      replyTo: user.email
    });
    return this.getThreadForUser(thread.id, user.id);
  }

  async replyAsAdmin(admin: AuthenticatedUser, threadId: string, input: ReplyFeedbackInput) {
    const thread = await this.getThreadForAdmin(threadId);
    const message = await this.store.createMessage({
      threadId: thread.id,
      senderId: admin.id,
      senderRole: 'admin',
      senderEmail: admin.email,
      message: requireMessage(input.message)
    });
    this.queueEmail(message.id, {
      to: thread.user_email,
      subject: userSubject(thread),
      text: userReplyText(thread, message.message),
      replyTo: supportEmail()
    });
    return this.getThreadForAdmin(thread.id);
  }

  async listForUser(userId: string) {
    return this.store.listThreads(userId);
  }

  async listForAdmin() {
    return this.store.listThreads(undefined, 200);
  }

  async getThreadForUser(threadId: string, userId: string): Promise<FeedbackThreadWithMessages> {
    const thread = await this.store.getThread(threadId, userId);
    if (!thread) throw new Error('Feedback thread was not found.');
    return thread;
  }

  async getThreadForAdmin(threadId: string): Promise<FeedbackThreadWithMessages> {
    const thread = await this.store.getThread(threadId);
    if (!thread) throw new Error('Feedback thread was not found.');
    return thread;
  }

  async updateStatus(threadId: string, status: FeedbackStatus) {
    return this.store.updateThreadStatus(threadId, status);
  }
}
