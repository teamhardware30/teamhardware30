import { Body, Controller, Get, Post, Query, Render, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { User } from '../../db/schema';
import { AuthService } from './auth.service';
import { safeNext, pushFlash } from './auth.utils';
import { GoogleOAuthGuard, LinkedinOAuthGuard } from './guards/oauth.guard';
import { loginSchema, registerSchema, resendVerificationSchema } from './schemas/auth.schemas';

const RESEND_VERIFICATION_MESSAGE =
  'If an account with that email needs verification, a new verification link has been sent.';

function loginUser(req: Request, user: User): Promise<void> {
  return new Promise((resolve, reject) => {
    req.logIn(user, (error) => (error ? reject(error) : resolve()));
  });
}

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  @Render('auth/login')
  loginPage(@Query('next') next?: string) {
    return { next: safeNext(next) };
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() body: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const next = safeNext(body.next);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      res.status(422).render('auth/login', { next, values: body, fieldErrors: fieldErrorsOf(parsed.error) });
      return;
    }

    try {
      const user = await this.authService.validateLocal(parsed.data.email, parsed.data.password);
      await loginUser(req, user);
      if (req.headers['hx-request']) {
        res.setHeader('HX-Redirect', next);
        res.sendStatus(200);
      } else {
        res.redirect(next);
      }
    } catch (error) {
      res.status(422).render('auth/login', {
        next,
        values: body,
        fieldErrors: { _root: error instanceof Error ? error.message : 'Invalid email or password' },
      });
    }
  }

  @Get('register')
  @Render('auth/register')
  registerPage() {
    return {};
  }

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body() body: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      res.status(422).render('auth/register', { values: body, fieldErrors: fieldErrorsOf(parsed.error) });
      return;
    }

    try {
      await this.authService.register(parsed.data.email, parsed.data.password, parsed.data.name);
    } catch (error) {
      res.status(422).render('auth/register', {
        values: body,
        fieldErrors: { _root: error instanceof Error ? error.message : 'Could not create account' },
      });
      return;
    }

    pushFlash(req, 'success', 'Check your inbox for a link to verify your email address.');
    if (req.headers['hx-request']) {
      res.setHeader('HX-Redirect', '/login');
      res.sendStatus(200);
    } else {
      res.redirect('/login');
    }
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string | undefined, @Req() req: Request, @Res() res: Response) {
    try {
      if (!token) {
        throw new Error('Missing verification token');
      }
      await this.authService.verifyEmail(token);
      pushFlash(req, 'success', 'Your email is verified. You can sign in now.');
    } catch {
      pushFlash(req, 'error', 'That verification link is invalid or has expired.');
    }
    res.redirect('/login');
  }

  @Post('resend-verification')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(@Body() body: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const parsed = resendVerificationSchema.safeParse(body);
    if (parsed.success) {
      await this.authService.resendVerificationEmail(parsed.data.email);
    }

    pushFlash(req, 'info', RESEND_VERIFICATION_MESSAGE);
    if (req.headers['hx-request']) {
      res.setHeader('HX-Redirect', '/login');
      res.sendStatus(200);
    } else {
      res.redirect('/login');
    }
  }

  @Post('logout')
  logout(@Req() req: Request, @Res() res: Response) {
    req.logout(() => res.redirect('/login'));
  }

  @Get('auth/linkedin')
  @UseGuards(AuthGuard('linkedin'))
  linkedinAuth() {}

  @Get('auth/linkedin/callback')
  @UseGuards(LinkedinOAuthGuard)
  async linkedinCallback(@Req() req: Request, @Res() res: Response) {
    await loginUser(req, req.user as User);
    res.redirect('/profile');
  }

  @Get('auth/google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {}

  @Get('auth/google/callback')
  @UseGuards(GoogleOAuthGuard)
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    await loginUser(req, req.user as User);
    res.redirect('/profile');
  }
}

function fieldErrorsOf(error: { issues: { path: (string | number)[]; message: string }[] }): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}
