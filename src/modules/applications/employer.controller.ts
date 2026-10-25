import { Body, Controller, Get, Post, Render, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import sanitizeHtml from 'sanitize-html';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { jobFingerprint } from '../crawler/crawler.utils';
import { JobsService } from '../jobs/jobs.service';
import { ProfilesService } from '../profiles/profiles.service';

@Controller('employer')
@UseGuards(AuthenticatedGuard, RolesGuard)
@Roles('employer', 'admin')
export class EmployerController {
  constructor(private readonly jobsService: JobsService, private readonly profilesService: ProfilesService) {}

  @Get('jobs')
  @Render('employer/jobs')
  async jobs(@Req() req: Request) {
    const user = req.user as { id: string };
    const allJobs = await this.jobsService.search({ limit: 50 });
    return { jobs: allJobs.jobs.filter((job) => job.employerId === user.id) };
  }

  @Get('jobs/new')
  @Render('employer/new-job')
  newJob() {
    return {};
  }

  @Post('jobs')
  async createJob(@Body() body: Record<string, string>, @Req() _req: Request) {
    const user = _req.user as { id: string };
    const title = body.title?.trim() || 'Untitled role';
    const company = body.company?.trim() || 'Company';
    const city = body.location?.trim() || null;
    await this.jobsService.createJob({
      employerId: user.id,
      title,
      company,
      location: body.location || null,
      city,
      country: null,
      remote: body.remote === 'on',
      employmentType: body.employmentType || 'full_time',
      descriptionHtml: sanitizeHtml(`<p>${body.description ?? ''}</p>`),
      descriptionText: body.description ?? '',
      applyMethod: 'onsite',
      fingerprint: jobFingerprint(title, company, city ?? ''),
      isActive: true,
      postedAt: new Date(),
      lastSeenAt: new Date(),
      crawledAt: new Date(),
    } as never);
    return { url: '/employer/jobs' };
  }

  @Get('jobs/:id/applicants')
  @Render('employer/applicants')
  async applicants() {
    return { applicants: [] };
  }
}
