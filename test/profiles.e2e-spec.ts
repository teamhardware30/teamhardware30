import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext } from './setup-e2e';
import { createTestApp, closeTestApp, tokenFromVerifyUrl } from './setup-e2e';

function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) {
    throw new Error('CSRF token not found in response HTML');
  }
  return match[1];
}

async function registerAndLogin(ctx: TestContext, email: string) {
  const server = ctx.app.getHttpServer();
  const agent = request.agent(server);

  const registerPage = await agent.get('/register');
  const registerCsrf = extractCsrf(registerPage.text);
  await agent.post('/register').send({ _csrf: registerCsrf, name: 'Test User', email, password: 'a-strong-password' });

  const call = ctx.sendVerificationEmail.mock.calls.at(-1) as [string, string];
  const token = tokenFromVerifyUrl(call[1]);
  await agent.get(`/verify-email?token=${token}`);

  const loginPage = await agent.get('/login');
  const loginCsrf = extractCsrf(loginPage.text);
  await agent.post('/login').send({ _csrf: loginCsrf, email, password: 'a-strong-password' });

  return agent;
}

describe('Profiles (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('serves the onboarding wizard at step 1 for a fresh profile', async () => {
    const agent = await registerAndLogin(ctx, 'onboarding@example.com');
    const res = await agent.get('/onboarding');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Upload your CV');
  });

  it('accepts a CV upload and starts parsing', async () => {
    const agent = await registerAndLogin(ctx, 'upload@example.com');
    const onboardingPage = await agent.get('/onboarding');
    const csrf = extractCsrf(onboardingPage.text);

    const pdfBuffer = Buffer.from('%PDF-1.4\n%mock resume content for testing\n%%EOF');

    const res = await agent
      .post('/onboarding/resume')
      .set('hx-request', 'true')
      .set('x-csrf-token', csrf)
      .attach('resume', pdfBuffer, { filename: 'cv.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Reading your CV');
  });

  it('rejects a disallowed file type', async () => {
    const agent = await registerAndLogin(ctx, 'badfile@example.com');
    const onboardingPage = await agent.get('/onboarding');
    const csrf = extractCsrf(onboardingPage.text);

    const res = await agent
      .post('/onboarding/resume')
      .set('hx-request', 'true')
      .set('x-csrf-token', csrf)
      .attach('resume', Buffer.from('plain text, not a resume'), { filename: 'notes.txt', contentType: 'text/plain' });

    expect(res.status).toBe(422);
  });

  it('renders 422 with field errors for an invalid experience', async () => {
    const agent = await registerAndLogin(ctx, 'experience@example.com');
    const onboardingPage = await agent.get('/onboarding');
    const csrf = extractCsrf(onboardingPage.text);

    const res = await agent
      .post('/onboarding/experiences')
      .set('hx-request', 'true')
      .send({ _csrf: csrf, company: '', title: '' });

    expect(res.status).toBe(422);
  });

  it('saves job preferences and redirects to /matches', async () => {
    const agent = await registerAndLogin(ctx, 'prefs@example.com');
    const onboardingPage = await agent.get('/onboarding');
    const csrf = extractCsrf(onboardingPage.text);

    const res = await agent.post('/onboarding/preferences').send({
      _csrf: csrf,
      desiredTitles: 'Software Engineer, Product Manager',
      locations: 'Nairobi, Remote',
      remote: 'on',
      salaryMin: '100000',
      salaryMax: '200000',
      salaryCurrency: 'KES',
      jobTypes: 'full_time',
    });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/matches');
  });
});
