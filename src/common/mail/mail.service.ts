import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: nodemailer.Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.from = config.get<string>('SMTP_FROM') ?? 'no-reply@job-copilot.local';
    this.transport = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST'),
      port: config.get<number>('SMTP_PORT'),
      auth: config.get<string>('SMTP_USER')
        ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') }
        : undefined,
    });
  }

  async sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to,
        subject: 'Verify your Job Copilot account',
        text: `Confirm your email address: ${verifyUrl}`,
        html: `<p>Confirm your email address to finish creating your Job Copilot account.</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>`,
      });
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${to}: ${String(error)}`);
    }
  }
}
