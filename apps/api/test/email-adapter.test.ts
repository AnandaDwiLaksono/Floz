import { describe, it, expect } from 'vitest';
import { InMemoryEmailAdapter, DevMailboxEmailAdapter } from '../src/email-adapter';
import fs from 'node:fs';
import path from 'node:path';

describe('Email Delivery Adapter', () => {
  it('InMemoryEmailAdapter records sent emails deterministically', async () => {
    const adapter = new InMemoryEmailAdapter();
    await adapter.sendEmail({
      to: 'user@example.com',
      subject: 'Welcome',
      html: '<p>Hi</p>'
    });
    expect(adapter.sent.length).toBe(1);
    expect(adapter.sent[0].to).toBe('user@example.com');
    expect(adapter.sent[0].subject).toBe('Welcome');
    adapter.clear();
    expect(adapter.sent.length).toBe(0);
  });

  it('DevMailboxEmailAdapter writes to custom mailbox file', async () => {
    const testMailbox = path.join(process.cwd(), '.test-mailbox.json');
    if (fs.existsSync(testMailbox)) fs.unlinkSync(testMailbox);

    const adapter = new DevMailboxEmailAdapter(testMailbox);
    await adapter.sendEmail({
      to: 'dev@floz.local',
      subject: 'Dev Verification',
      html: '<p>Link: http://localhost:3000/verify-email?token=123</p>'
    });

    expect(fs.existsSync(testMailbox)).toBe(true);
    const content = JSON.parse(fs.readFileSync(testMailbox, 'utf8'));
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].to).toBe('dev@floz.local');

    if (fs.existsSync(testMailbox)) fs.unlinkSync(testMailbox);
  });
});
