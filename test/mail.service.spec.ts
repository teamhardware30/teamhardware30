import { ConfigService } from '@nestjs/config';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MailService } from '../src/common/mail/mail.service';

function config(values: Record<string, string | number | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('MailService with BREVO_API_KEY', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends verification email through the Brevo HTTP API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: '<abc@brevo>' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new MailService(
      config({ BREVO_API_KEY: 'xkeysib-test', SMTP_FROM: 'Job Copilot <no-reply@example.com>' })
    );
    await service.sendVerificationEmail('tester@example.com', 'https://example.com/verify-email?token=1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ email: 'no-reply@example.com', name: 'Job Copilot' });
    expect(body.to).toEqual([{ email: 'tester@example.com' }]);
    expect(body.textContent).toContain('https://example.com/verify-email?token=1');
  });

  it('sends application attachments as base64 through the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: '<def@brevo>' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new MailService(config({ BREVO_API_KEY: 'xkeysib-test', SMTP_FROM: 'no-reply@example.com' }));
    const id = await service.sendApplicationEmail({
      to: 'jobs@example.com',
      replyTo: 'candidate@example.com',
      subject: 'Application',
      text: 'Please find my CV attached.',
      attachment: Buffer.from('pdf-bytes'),
      fileName: 'cv.pdf',
    });

    expect(id).toBe('<def@brevo>');
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.replyTo).toEqual({ email: 'candidate@example.com' });
    expect(body.attachment).toEqual([
      { name: 'cv.pdf', content: Buffer.from('pdf-bytes').toString('base64') },
    ]);
  });

  it('logs and swallows verification failures so signup still succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }));

    const service = new MailService(config({ BREVO_API_KEY: 'bad', SMTP_FROM: 'no-reply@example.com' }));
    await expect(service.sendVerificationEmail('tester@example.com', 'https://example.com/v')).resolves.toBeUndefined();
  });

  it('returns null when an application email fails to send', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const service = new MailService(config({ BREVO_API_KEY: 'bad', SMTP_FROM: 'no-reply@example.com' }));
    await expect(
      service.sendApplicationEmail({
        to: 'jobs@example.com',
        replyTo: 'candidate@example.com',
        subject: 'Application',
        text: 'hi',
      })
    ).resolves.toBeNull();
  });
});
