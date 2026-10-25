import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from './setup-e2e';
import { createTestApp, closeTestApp, tokenFromVerifyUrl } from './setup-e2e';

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'correct-horse-battery';

function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) {
    throw new Error('CSRF token not found in response HTML');
  }
  return match[1];
}

async function registerUser(ctx: TestContext, agent: TestAgent, email: string): Promise<string> {
  const registerPage = await agent.get('/register');
  const register = await agent.post('/register').send({
    _csrf: extractCsrf(registerPage.text),
    name: 'Test User',
    email,
    password: PASSWORD,
  });
  expect(register.status).toBe(302);
  expect(register.headers.location).toBe('/login');

  const lastCall = ctx.sendVerificationEmail.mock.calls.at(-1);
  if (!lastCall) {
    throw new Error('Verification email was not sent');
  }
  return tokenFromVerifyUrl(lastCall[1] as string);
}

async function verifyUser(agent: TestAgent, token: string): Promise<void> {
  const verify = await agent.get(`/verify-email?token=${token}`);
  expect(verify.status).toBe(302);
  expect(verify.headers.location).toBe('/login');
}

async function signIn(agent: TestAgent, email: string, next?: string) {
  const loginPage = await agent.get('/login');
  return agent.post('/login').send({
    _csrf: extractCsrf(loginPage.text),
    email,
    password: PASSWORD,
    next,
  });
}

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  beforeEach(() => {
    ctx.sendVerificationEmail.mockClear();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('rejects mutating auth requests without a CSRF token', async () => {
    const server = ctx.app.getHttpServer();

    for (const path of ['/login', '/register', '/resend-verification', '/logout']) {
      const res = await request(server).post(path).send({ email: 'ada@example.com', password: 'whatever' });
      expect(res.status).toBe(403);
    }
  });

  it('registers, verifies, and signs a user in', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const email = `${randomUUID()}@example.com`;
    const token = await registerUser(ctx, agent, email);
    expect(ctx.sendVerificationEmail).toHaveBeenCalledTimes(1);

    const failedLogin = await signIn(agent, email);
    expect(failedLogin.status).toBe(422);

    await verifyUser(agent, token);
    const login = await signIn(agent, email);
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/profile');

    const profile = await agent.get('/profile');
    expect(profile.status).toBe(200);
  });

  it('does not honor a protocol-relative next URL after local login', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const email = `${randomUUID()}@example.com`;
    const token = await registerUser(ctx, agent, email);
    await verifyUser(agent, token);

    const login = await signIn(agent, email, '//evil.example/phish');
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/profile');
  });

  it('redirects unauthenticated access to /profile to the login page', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/profile');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login/);
  });

  it('logs the user out', async () => {
    const agent = request.agent(ctx.app.getHttpServer());
    const email = `${randomUUID()}@example.com`;
    const token = await registerUser(ctx, agent, email);
    await verifyUser(agent, token);
    const login = await signIn(agent, email);
    expect(login.status).toBe(302);

    const profilePage = await agent.get('/profile');
    const logout = await agent.post('/logout').send({ _csrf: extractCsrf(profilePage.text) });
    expect(logout.status).toBe(302);

    const profileAfterLogout = await agent.get('/profile');
    expect(profileAfterLogout.status).toBe(302);
  });

  it('resends verification with a neutral response and ignores unknown or verified emails', async () => {
    const knownAgent = request.agent(ctx.app.getHttpServer());
    const unknownAgent = request.agent(ctx.app.getHttpServer());
    const email = `${randomUUID()}@example.com`;
    await registerUser(ctx, knownAgent, email);
    ctx.sendVerificationEmail.mockClear();

    const knownLogin = await knownAgent.get('/login');
    const knownResponse = await knownAgent
      .post('/resend-verification')
      .send({ _csrf: extractCsrf(knownLogin.text), email });
    expect(knownResponse.status).toBe(302);
    expect(knownResponse.headers.location).toBe('/login');
    expect(ctx.sendVerificationEmail).toHaveBeenCalledTimes(1);
    const knownFlash = await knownAgent.get('/login');

    const unknownLogin = await unknownAgent.get('/login');
    const unknownResponse = await unknownAgent.post('/resend-verification').send({
      _csrf: extractCsrf(unknownLogin.text),
      email: `${randomUUID()}@example.com`,
    });
    expect(unknownResponse.status).toBe(knownResponse.status);
    expect(unknownResponse.headers.location).toBe(knownResponse.headers.location);
    const unknownFlash = await unknownAgent.get('/login');
    expect(ctx.sendVerificationEmail).toHaveBeenCalledTimes(1);

    const neutralMessage = 'If an account with that email needs verification';
    expect(knownFlash.text).toContain(neutralMessage);
    expect(unknownFlash.text).toContain(neutralMessage);

    const lastCall = ctx.sendVerificationEmail.mock.calls.at(-1);
    if (!lastCall) {
      throw new Error('Resent verification email was not sent');
    }
    await verifyUser(knownAgent, tokenFromVerifyUrl(lastCall[1] as string));
    ctx.sendVerificationEmail.mockClear();

    const verifiedLogin = await knownAgent.get('/login');
    const verifiedResponse = await knownAgent
      .post('/resend-verification')
      .send({ _csrf: extractCsrf(verifiedLogin.text), email });
    expect(verifiedResponse.status).toBe(knownResponse.status);
    expect(verifiedResponse.headers.location).toBe(knownResponse.headers.location);
    expect(ctx.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it.each([
    { provider: 'google', name: 'Google' },
    { provider: 'linkedin', name: 'LinkedIn' },
  ])('redirects $name consent denial to login with a friendly flash', async ({ provider, name }) => {
    const agent = request.agent(ctx.app.getHttpServer());
    const response = await agent.get(`/auth/${provider}/callback?error=access_denied`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
    const login = await agent.get('/login');
    expect(login.text).toContain(`${name} sign-in was cancelled or could not be completed`);
  });
});
