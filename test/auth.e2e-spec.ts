import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestApp, closeTestApp, tokenFromVerifyUrl, TestContext } from './setup-e2e';

function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  if (!match) {
    throw new Error('CSRF token not found in response HTML');
  }
  return match[1];
}

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('rejects a POST without a CSRF token', async () => {
    const server = ctx.app.getHttpServer();
    const res = await request(server).post('/login').send({ email: 'a@b.com', password: 'whatever' });
    expect(res.status).toBe(403);
  });

  it('registers, verifies, and signs a user in', async () => {
    const server = ctx.app.getHttpServer();
    const agent = request.agent(server);

    const registerPage = await agent.get('/register');
    const csrf = extractCsrf(registerPage.text);

    const register = await agent.post('/register').send({
      _csrf: csrf,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct-horse-battery',
    });
    expect(register.status).toBe(302);
    expect(register.headers.location).toBe('/login');
    expect(ctx.sendVerificationEmail).toHaveBeenCalledTimes(1);

    const loginBeforeVerify = await agent.get('/login');
    const loginCsrf = extractCsrf(loginBeforeVerify.text);
    const failedLogin = await agent.post('/login').send({
      _csrf: loginCsrf,
      email: 'ada@example.com',
      password: 'correct-horse-battery',
    });
    expect(failedLogin.status).toBe(422);

    const verifyUrl = ctx.sendVerificationEmail.mock.calls[0][1] as string;
    const token = tokenFromVerifyUrl(verifyUrl);
    const verify = await agent.get(`/verify-email?token=${token}`);
    expect(verify.status).toBe(302);
    expect(verify.headers.location).toBe('/login');

    const loginPage = await agent.get('/login');
    const freshCsrf = extractCsrf(loginPage.text);
    const login = await agent.post('/login').send({
      _csrf: freshCsrf,
      email: 'ada@example.com',
      password: 'correct-horse-battery',
    });
    expect(login.status).toBe(302);
    expect(login.headers.location).toBe('/profile');

    const profile = await agent.get('/profile');
    expect(profile.status).toBe(200);
  });

  it('redirects unauthenticated access to /profile to the login page', async () => {
    const server = ctx.app.getHttpServer();
    const res = await request(server).get('/profile');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login/);
  });

  it('logs the user out', async () => {
    const server = ctx.app.getHttpServer();
    const agent = request.agent(server);

    const registerPage = await agent.get('/register');
    const csrf = extractCsrf(registerPage.text);
    await agent.post('/register').send({
      _csrf: csrf,
      name: 'Grace Hopper',
      email: 'grace@example.com',
      password: 'another-good-password',
    });

    const verifyUrl = ctx.sendVerificationEmail.mock.calls[1][1] as string;
    const token = tokenFromVerifyUrl(verifyUrl);
    await agent.get(`/verify-email?token=${token}`);

    const loginPage = await agent.get('/login');
    const loginCsrf = extractCsrf(loginPage.text);
    await agent.post('/login').send({ _csrf: loginCsrf, email: 'grace@example.com', password: 'another-good-password' });

    const profilePage = await agent.get('/profile');
    const logoutCsrf = extractCsrf(profilePage.text);
    const logout = await agent.post('/logout').send({ _csrf: logoutCsrf });
    expect(logout.status).toBe(302);

    const profileAfterLogout = await agent.get('/profile');
    expect(profileAfterLogout.status).toBe(302);
  });
});
