import { Body, Controller, Get, Patch, Param, Post, Render, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../db/schema';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { ProfilesService } from '../profiles/profiles.service';
import { ApplyService } from './apply.service';

@Controller()
@UseGuards(AuthenticatedGuard)
export class ApplicationsController {
  constructor(private readonly applyService: ApplyService, private readonly profilesService: ProfilesService) {}

  @Post('applications')
  async apply(@Body() body: Record<string, string>, @CurrentUser() user: User, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    try {
      const result = await this.applyService.apply(profile.id, body.jobId, { resumeId: body.resumeId, consent: body.consent === 'true' });
      if (result.channel === 'external_ats') {
        res.render('applications/partials/kit', { applyUrl: result.applyUrl, jobId: body.jobId });
        return;
      }
      res.render('applications/partials/applied-button', { jobId: body.jobId });
    } catch (error) {
      res.status(422).render('applications/partials/error', { message: error instanceof Error ? error.message : 'Could not apply' });
    }
  }

  @Get('applications')
  @Render('applications/index')
  async index(@CurrentUser() user: User) {
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const applications = await this.applyService.listApplications(profile.id);
    const grouped = {
      draft: applications.filter((item) => item.status === 'draft'),
      submitted: applications.filter((item) => item.status === 'submitted'),
      interview: applications.filter((item) => item.status === 'interview'),
      offer: applications.filter((item) => item.status === 'offer'),
      rejected: applications.filter((item) => item.status === 'rejected'),
    };
    return { applications, grouped };
  }

  @Patch('applications/:id/status')
  async updateStatus(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Record<string, string>, @Res() res: Response) {
    const allowed = ['draft', 'submitted', 'failed', 'viewed', 'interview', 'rejected', 'offer'];
    if (!allowed.includes(body.status)) {
      res.status(422).json({ message: 'Invalid application status' });
      return;
    }
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    await this.applyService.updateStatus(profile.id, id, body.status as never);
    res.sendStatus(204);
  }
}
