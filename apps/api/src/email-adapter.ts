import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  createdAt?: string;
}

export interface EmailDeliveryAdapter {
  sendEmail(msg: EmailMessage): Promise<void>;
}

export class InMemoryEmailAdapter implements EmailDeliveryAdapter {
  public sent: EmailMessage[] = [];

  async sendEmail(msg: EmailMessage): Promise<void> {
    this.sent.push({ ...msg, createdAt: new Date().toISOString() });
  }

  clear(): void {
    this.sent = [];
  }
}

export class DevMailboxEmailAdapter implements EmailDeliveryAdapter {
  private mailboxPath: string;

  constructor(customPath?: string) {
    this.mailboxPath = customPath || path.join(process.cwd(), '.dev-mailbox.json');
  }

  async sendEmail(msg: EmailMessage): Promise<void> {
    let list: EmailMessage[] = [];
    if (existsSync(this.mailboxPath)) {
      try {
        const raw = readFileSync(this.mailboxPath, 'utf8');
        list = JSON.parse(raw);
      } catch {
        list = [];
      }
    }
    list.unshift({ ...msg, createdAt: new Date().toISOString() });
    // Keep max 100 messages
    if (list.length > 100) list = list.slice(0, 100);
    writeFileSync(this.mailboxPath, JSON.stringify(list, null, 2), 'utf8');
  }
}

export class ResendEmailAdapter implements EmailDeliveryAdapter {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.RESEND_API_KEY || '';
  }

  async sendEmail(msg: EmailMessage): Promise<void> {
    if (!this.apiKey) {
      throw new Error('RESEND_API_KEY is required for production email adapter');
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Floz <no-reply@floz.local>',
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Resend email delivery failed: ${res.status} ${errText}`);
    }
  }
}

export function createEmailAdapter(): EmailDeliveryAdapter {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') {
    return new ResendEmailAdapter();
  }
  return new DevMailboxEmailAdapter();
}
