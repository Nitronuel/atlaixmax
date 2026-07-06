import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../auth';
import { FeedbackService, type FeedbackMailer } from './service';
import { FeedbackStore } from './store';

describe('feedback support conversations', () => {
  const originalCwd = process.cwd();
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSupabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const originalSupportEmail = process.env.SUPPORT_EMAIL;
  let workspace = '';
  let sent: Array<{ to: string | string[]; bcc?: string | string[]; subject: string; text: string; replyTo?: string }> = [];
  let failNext = false;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'atlaix-feedback-'));
    process.chdir(workspace);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    process.env.SUPPORT_EMAIL = 'support@atlaix.com';
    sent = [];
    failNext = false;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv('SUPABASE_URL', originalSupabaseUrl);
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalSupabaseServiceRoleKey);
    restoreEnv('SUPABASE_SERVICE_KEY', originalSupabaseServiceKey);
    restoreEnv('SUPPORT_EMAIL', originalSupportEmail);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('saves new feedback and emails support with sender details', async () => {
    const service = makeService();
    const thread = await service.createThread(user(), {
      subject: 'Wallet monitor issue',
      category: 'Bug',
      message: 'The monitor failed after I tracked a wallet.',
      sourcePath: '/wallet/0xabc',
      userName: 'Ada'
    });

    expect(thread.messages).toHaveLength(1);
    expect(thread.status).toBe('waiting_admin');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('support@atlaix.com');
    expect(sent[0].replyTo).toBe('ada@example.com');
    expect(sent[0].text).toContain('Sender: Ada <ada@example.com>');
    expect(sent[0].text).toContain('Source page: /wallet/0xabc');
    expect(sent[0].text).toContain('The monitor failed after I tracked a wallet.');
    const updated = await waitForThread(() => service.getThreadForUser(thread.id, user().id), (next) => Boolean(next.messages[0].email_sent_at));
    expect(updated.messages[0].email_sent_at).toBeTruthy();
  });

  it('keeps feedback saved when email delivery fails', async () => {
    const service = makeService();
    failNext = true;

    const thread = await service.createThread(user(), {
      subject: 'Email failure test',
      message: 'This should stay saved.'
    });

    expect(thread.messages).toHaveLength(1);
    const updated = await waitForThread(() => service.getThreadForUser(thread.id, user().id), (next) => next.messages[0].email_error === 'SMTP test failure.');
    expect(updated.messages[0].email_sent_at).toBeNull();
    expect(updated.messages[0].email_error).toBe('SMTP test failure.');
  });

  it('returns saved feedback before slow email delivery completes', async () => {
    const deferred: { resolve?: (value: { sent: boolean }) => void } = {};
    const mailer: FeedbackMailer = async (message) => {
      sent.push(message);
      return new Promise((resolve) => {
        deferred.resolve = resolve;
      });
    };
    const service = new FeedbackService(new FeedbackStore(), mailer);

    const thread = await service.createThread(user(), {
      subject: 'Slow SMTP',
      message: 'This should save before email finishes.'
    });

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0].email_sent_at).toBeNull();
    expect(sent).toHaveLength(1);
    deferred.resolve?.({ sent: true });
    const updated = await waitForThread(() => service.getThreadForUser(thread.id, user().id), (next) => Boolean(next.messages[0].email_sent_at));
    expect(updated.messages[0].email_sent_at).toBeTruthy();
  });

  it('emails the user and stores the message when admin replies', async () => {
    const service = makeService();
    const created = await service.createThread(user(), {
      subject: 'Need help',
      message: 'Can someone explain this alert?'
    });

    const replied = await service.replyAsAdmin(admin(), created.id, {
      message: 'Yes, the wallet alert is active now.'
    });

    expect(replied.status).toBe('waiting_user');
    expect(replied.messages.map((message) => message.sender_role)).toEqual(['user', 'admin']);
    expect(sent).toHaveLength(2);
    expect(sent[1].to).toBe('ada@example.com');
    expect(sent[1].bcc).toBe('support@atlaix.com');
    expect(sent[1].replyTo).toBe('support@atlaix.com');
    expect(sent[1].text).toContain('Yes, the wallet alert is active now.');
  });

  it('emails support when the user continues the conversation', async () => {
    const service = makeService();
    const created = await service.createThread(user(), {
      subject: 'Follow-up',
      message: 'First note.'
    });

    const replied = await service.replyAsUser(user(), created.id, {
      message: 'Here is the extra detail.'
    });

    expect(replied.status).toBe('waiting_admin');
    expect(replied.messages).toHaveLength(2);
    expect(sent[1].to).toBe('support@atlaix.com');
    expect(sent[1].text).toContain('User replied to Atlaix feedback');
    expect(sent[1].text).toContain('Here is the extra detail.');
  });

  it('does not let a user read another user feedback thread', async () => {
    const service = makeService();
    const created = await service.createThread(user(), {
      subject: 'Private',
      message: 'Only Ada should see this.'
    });

    await expect(service.getThreadForUser(created.id, 'user-2')).rejects.toThrow('Feedback thread was not found.');
  });

  function makeService() {
    const mailer: FeedbackMailer = async (message) => {
      sent.push(message);
      if (failNext) {
        failNext = false;
        return { sent: false, reason: 'SMTP test failure.' };
      }
      return { sent: true };
    };
    return new FeedbackService(new FeedbackStore(), mailer);
  }
});

function user(): AuthenticatedUser {
  return { id: 'user-1', email: 'ada@example.com' };
}

function admin(): AuthenticatedUser {
  return { id: 'admin-1', email: 'admin@atlaix.com' };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function waitForThread<T>(load: () => Promise<T>, predicate: (value: T) => boolean) {
  let latest = await load();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 10));
    latest = await load();
  }
  return latest;
}
