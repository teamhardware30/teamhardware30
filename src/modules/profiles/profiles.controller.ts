import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Request, Response } from 'express';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { ProfilesService } from './profiles.service';
import { ResumeUploadService } from './resume-upload.service';
import { PARSE_RESUME_QUEUE } from './parse-resume.processor';
import { experienceSchema, educationSchema, preferencesSchema, skillSchema, jobTypeValues } from './schemas/profile.schemas';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { User } from '../../db/schema';

@Controller()
@UseGuards(AuthenticatedGuard)
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly resumeUploadService: ResumeUploadService,
    @InjectQueue(PARSE_RESUME_QUEUE) private readonly parseResumeQueue: Queue,
  ) {}

  @Get('onboarding')
  @Render('profiles/onboarding')
  async onboarding(@Req() req: Request) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    const step = profile.parseStatus === 'done' ? 3 : profile.parseStatus === 'pending' ? 1 : 2;
    return { profile, step, jobTypeValues };
  }

  @Get('onboarding/steps/:step')
  async onboardingStep(@Param('step') step: string, @Req() req: Request, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    await this.renderStep(res, Number(step), profile.id);
  }

  @Post('onboarding/resume')
  @UseInterceptors(FileInterceptor('resume'))
  async uploadResume(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);

    if (!file) {
      res.status(422).render('profiles/partials/onboarding-step-1', {
        profile,
        fieldErrors: { resume: 'Choose a CV file to upload' },
      });
      return;
    }

    try {
      const uploaded = await this.resumeUploadService.upload(file, user.id);
      await this.profilesService.addResume(profile.id, { fileName: file.originalname, ...uploaded });
      await this.profilesService.setParseStatus(profile.id, 'processing');
      const resumes = await this.profilesService.listResumes(profile.id);
      const [latest] = resumes;
      await this.parseResumeQueue.add('parse', { profileId: profile.id, resumeId: latest.id });
      res.render('profiles/partials/onboarding-step-2', { profile: { ...profile, parseStatus: 'processing' } });
    } catch (error) {
      res.status(422).render('profiles/partials/onboarding-step-1', {
        profile,
        fieldErrors: { resume: error instanceof Error ? error.message : 'Could not upload this file' },
      });
    }
  }

  @Get('onboarding/resume/status')
  async resumeStatus(@Req() req: Request, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    if (profile.parseStatus === 'done') {
      await this.renderStep(res, 3, profile.id);
      return;
    }
    res.render('profiles/partials/onboarding-step-2', { profile });
  }

  @Post('onboarding/experiences')
  async addExperience(
    @Body(new ZodValidationPipe(experienceSchema)) body: ReturnType<typeof experienceSchema.parse>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    await this.profilesService.addExperience(profile.id, {
      ...body,
      location: body.location || null,
      startDate: body.startDate || null,
      endDate: body.endDate || null,
      description: body.description || null,
    });
    const experiences = await this.profilesService.listExperiences(profile.id);
    res.render('profiles/partials/experiences-list', { experiences });
  }

  @Delete('onboarding/experiences/:id')
  async removeExperience(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    await this.profilesService.removeExperience(profile.id, id);
    const experiences = await this.profilesService.listExperiences(profile.id);
    res.render('profiles/partials/experiences-list', { experiences });
  }

  @Post('onboarding/educations')
  async addEducation(
    @Body(new ZodValidationPipe(educationSchema)) body: ReturnType<typeof educationSchema.parse>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    await this.profilesService.addEducation(profile.id, {
      ...body,
      degree: body.degree || null,
      fieldOfStudy: body.fieldOfStudy || null,
      startDate: body.startDate || null,
      endDate: body.endDate || null,
      description: body.description || null,
    });
    const educations = await this.profilesService.listEducations(profile.id);
    res.render('profiles/partials/educations-list', { educations });
  }

  @Delete('onboarding/educations/:id')
  async removeEducation(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    await this.profilesService.removeEducation(profile.id, id);
    const educations = await this.profilesService.listEducations(profile.id);
    res.render('profiles/partials/educations-list', { educations });
  }

  @Get('skills/suggest')
  async suggestSkills(@Query('q') q: string | undefined, @Res() res: Response) {
    const suggestions = await this.profilesService.suggestSkills(q ?? '');
    res.render('profiles/partials/skill-suggestions', { suggestions });
  }

  @Post('onboarding/skills')
  async addSkill(
    @Body(new ZodValidationPipe(skillSchema)) body: ReturnType<typeof skillSchema.parse>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    const profileSkills = await this.profilesService.addSkill(profile.id, body.name);
    res.render('profiles/partials/skill-chips', { profileSkills });
  }

  @Delete('onboarding/skills/:skillId')
  async removeSkill(@Param('skillId') skillId: string, @Req() req: Request, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    const profileSkills = await this.profilesService.removeSkill(profile.id, skillId);
    res.render('profiles/partials/skill-chips', { profileSkills });
  }

  @Post('onboarding/preferences')
  async savePreferences(
    @Body(new ZodValidationPipe(preferencesSchema)) body: ReturnType<typeof preferencesSchema.parse>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    await this.profilesService.updatePreferences(profile.id, body);
    if (req.headers['hx-request']) {
      res.setHeader('HX-Redirect', '/matches');
      res.sendStatus(200);
    } else {
      res.redirect('/matches');
    }
  }

  @Get('profile')
  @Render('profiles/profile')
  async profilePage(@Req() req: Request) {
    await this.profilesService.getOrCreateForUser(currentUser(req).id);
    const profile = await this.profilesService.findFullProfile(currentUser(req).id);
    return { profile, jobTypeValues };
  }

  @Post('profile')
  async updateProfile(@Body() body: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    await this.profilesService.updateProfile(profile.id, {
      headline: body.headline || null,
      summary: body.summary || null,
    });
    const full = await this.profilesService.findFullProfile(currentUser(req).id);
    res.render('profiles/partials/profile-summary', { profile: full });
  }

  @Post('profile/resumes')
  @UseInterceptors(FileInterceptor('resume'))
  async addProfileResume(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    if (file) {
      const uploaded = await this.resumeUploadService.upload(file, user.id);
      await this.profilesService.addResume(profile.id, { fileName: file.originalname, ...uploaded });
    }
    const resumes = await this.profilesService.listResumes(profile.id);
    res.render('profiles/partials/resumes-list', { resumes });
  }

  @Post('profile/resumes/:id/primary')
  async setPrimaryResume(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    const resumes = await this.profilesService.setPrimaryResume(profile.id, id);
    res.render('profiles/partials/resumes-list', { resumes });
  }

  @Delete('profile/resumes/:id')
  async removeResume(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const profile = await this.profilesService.getOrCreateForUser(currentUser(req).id);
    const resumes = await this.profilesService.removeResume(profile.id, id);
    res.render('profiles/partials/resumes-list', { resumes });
  }

  private async renderStep(res: Response, step: number, profileId: string) {
    if (step === 3) {
      const [experiences, educations, profileSkills] = await Promise.all([
        this.profilesService.listExperiences(profileId),
        this.profilesService.listEducations(profileId),
        this.profilesService.listProfileSkills(profileId),
      ]);
      res.render('profiles/partials/onboarding-step-3', { experiences, educations, profileSkills });
      return;
    }
    if (step === 4) {
      res.render('profiles/partials/onboarding-step-4', { jobTypeValues });
      return;
    }
    res.render(`profiles/partials/onboarding-step-${step}`, {});
  }
}

function currentUser(req: Request): User {
  return req.user as User;
}
