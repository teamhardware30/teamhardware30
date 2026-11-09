import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachment?: { content: Buffer; name: string };
}

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

function parseAddress(value: string): { email: string; name?: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].replace(/^"|"$/g, '').trim();
    return name ? { email: match[2].trim(), name } : { email: match[2].trim() };
  }
  return { email: value.trim() };
}

/**
 * Sends transactional email. Prefers the Brevo HTTP API when BREVO_API_KEY is
 * configured because many hosts (e.g. Railway) block outbound SMTP ports;
 * otherwise falls back to plain SMTP, which is what local Mailpit uses.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport?: nodemailer.Transporter;
  private readonly from: string;
  private readonly brevoApiKey?: string;

  constructor(private readonly config: ConfigService) {
    this.from = config.get<string>('SMTP_FROM') ?? 'no-reply@job-copilot.local';
    this.brevoApiKey = config.get<string>('BREVO_API_KEY');
    if (!this.brevoApiKey) {
      this.transport = nodemailer.createTransport({
        host: config.get<string>('SMTP_HOST'),
        port: config.get<number>('SMTP_PORT'),
        auth: config.get<string>('SMTP_USER')
          ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') }
          : undefined,
      });
    }
  }

  async sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
    try {
      await this.deliver({
        to,
        subject: 'Verify your Job Copilot account',
        text: `Confirm your email address: ${verifyUrl}`,
        html: `<p>Confirm your email address to finish creating your Job Copilot account.</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
      });
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${to}: ${String(error)}`);
    }
  }

  async sendApplicationEmail(input: { to: string; replyTo: string; subject: string; text: string; attachment?: Buffer; fileName?: string }): Promise<string | null> {
    try {
      return await this.deliver({
        to: input.to,
        replyTo: input.replyTo,
        subject: input.subject,
        text: input.text,
        attachment: input.attachment
          ? { content: input.attachment, name: input.fileName ?? 'resume.pdf' }
          : undefined,
      });
    } catch (error) {
      this.logger.error(`Failed to send application email to ${input.to}: ${String(error)}`);
      return null;
    }
  }

  private async deliver(message: MailMessage): Promise<string | null> {
    if (this.brevoApiKey) {
      return this.deliverViaBrevo(message, this.brevoApiKey);
    }
    const result = await this.transport!.sendMail({
      from: this.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachment
        ? [{ filename: message.attachment.name, content: message.attachment.content }]
        : undefined,
    });
    return result.messageId ?? null;
  }

  private async deliverViaBrevo(message: MailMessage, apiKey: string): Promise<string | null> {
    const sender = parseAddress(this.from);
    const body: Record<string, unknown> = {
      sender,
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.text,
    };
    if (message.html) body.htmlContent = message.html;
    if (message.replyTo) body.replyTo = parseAddress(message.replyTo);
    if (message.attachment) {
      body.attachment = [
        { name: message.attachment.name, content: message.attachment.content.toString('base64') },
      ];
    }

    const response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Brevo API responded ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }
    const payload = (await response.json().catch(() => ({}))) as { messageId?: string };
    return payload.messageId ?? null;
  }
}
