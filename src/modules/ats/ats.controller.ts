import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Render, Res, UseGuards } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Response } from 'express';
import Redis from 'ioredis';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { User } from '../../db/schema';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { ProfilesService } from '../profiles/profiles.service';
import { AtsService, ATS_SCAN_QUEUE } from './ats.service';

@Controller('ats')
@UseGuards(AuthenticatedGuard)
export class AtsController {
  constructor(
    private readonly atsService: AtsService,
    private readonly profilesService: ProfilesService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(ATS_SCAN_QUEUE) private readonly scanQueue: Queue,
  ) {}

  @Post('scans')
  @HttpCode(HttpStatus.OK)
  async createScan(@Body() body: Record<string, string>, @CurrentUser() user: User, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const resumes = await this.profilesService.listResumes(profile.id);
    const resume = resumes.find((item) => item.id === body.resumeId) ?? resumes[0];
    if (!resume) {
      res.status(422).render('ats/partials/progress', { status: 'failed', error: 'Upload a resume before scanning.' });
      return;
    }
    const dailyKey = `ats:scans:${user.id}:${new Date().toISOString().slice(0, 10)}`;
    const used = Number(await this.redis.get(dailyKey) ?? 0);
    if (used >= 20) {
      res.status(429).render('ats/partials/progress', { status: 'failed', error: 'You have reached the daily scan limit of 20.' });
      return;
    }
    await this.redis.incr(dailyKey);
    await this.redis.expire(dailyKey, 86400);
    const jobId = `ats-scan-${user.id}-${resume.id}-${body.jobId ?? 'profile'}-${Date.now()}`;
    const job = await this.scanQueue.add('scan', { userId: user.id, resumeId: resume.id, jobId: body.jobId }, { jobId, removeOnComplete: true, removeOnFail: false });
    res.render('ats/partials/progress', { jobId: job.id ?? jobId, status: 'processing' });
  }

  @Get('scans/:jobId/status')
  async scanStatus(@Param('jobId') jobId: string, @Res() res: Response) {
    const job = await this.scanQueue.getJob(jobId);
    if (!job) {
      res.status(404).render('ats/partials/progress', { status: 'failed', error: 'Scan job not found.' });
      return;
    }
    if (await job.isCompleted()) {
      const result = await job.returnvalue;
      res.setHeader('HX-Redirect', `/ats/${result.scanId}`);
      res.sendStatus(200);
      return;
    }
    if (await job.isFailed()) {
      res.render('ats/partials/progress', { status: 'failed', error: job.failedReason ?? 'Scan failed.' });
      return;
    }
    res.render('ats/partials/progress', { status: 'processing', jobId });
  }

  @Get(':scanId')
  @Render('ats/show')
  async show(@Param('scanId') scanId: string, @CurrentUser() user: User) {
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const scan = await this.atsService.getScan(scanId, profile.id);
    if (!scan) {
      throw new (await import('@nestjs/common')).NotFoundException('Scan not found');
    }
    return { scan };
  }

  @Post('scans/:id/tailor')
  @HttpCode(200)
  async tailor(@Param('id') id: string, @CurrentUser() user: User, @Res() res: Response) {
    const resumeId = await this.atsService.tailor(id, user.id);
    res.setHeader('HX-Redirect', `/profile/resumes/${resumeId}`);
    res.sendStatus(200);
  }
}
