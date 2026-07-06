import { describe, expect, it } from 'vitest';
import { buildPrivateBetaInviteEmail } from './store';

describe('beta application invite email', () => {
  it('matches the private beta approval template', () => {
    const email = buildPrivateBetaInviteEmail('Ada Lovelace', 'https://beta.atlaix.com/create-account?token=abc');

    expect(email.subject).toBe('Welcome to Atlaix Private Beta');
    expect(email.text).toBe([
      'Hi Ada Lovelace,',
      '',
      'Thank you for your interest in Atlaix.',
      '',
      "We're excited to let you know that your application has been approved. You're now invited to join the Atlaix Private Beta and get early access before our public launch.",
      '',
      'Click the button below to create your account and get started.',
      '',
      'Create Your Account: https://beta.atlaix.com/create-account?token=abc',
      '',
      'This invitation is linked to your approved email address and is intended for you only.',
      '',
      "We're excited to have you with us. Your feedback will help shape the future of Atlaix.",
      '',
      'Welcome aboard!'
    ].join('\n'));
    expect(email.html).toContain('src="https://beta.atlaix.com/logo.png"');
    expect(email.html).toContain('alt="Atlaix"');
    expect(email.html).toContain('Create Your Account');
    expect(email.html).toContain('https://beta.atlaix.com/create-account?token=abc');
  });

  it('escapes invite email html values', () => {
    const email = buildPrivateBetaInviteEmail('<Ada>', 'https://beta.atlaix.com/create-account?token=<abc>');

    expect(email.html).toContain('Hi &lt;Ada&gt;');
    expect(email.html).toContain('token=&lt;abc&gt;');
  });
});
