import { S3Client} from '@aws-sdk/client-s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InjectQueue } from '@nestjs/bullmq';
/* eslint-disable no-control-regex */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  HttpStatus,
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
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Queue } from 'bullmq';
import { Request, Response } from 'express';
import { User } from '../../db/schema';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { EMBED_PROFILE_QUEUE } from './embed-profile.processor';
import { PARSE_RESUME_QUEUE } from './parse-resume.processor';
import { ProfilesService } from './profiles.service';
import { ResumeUploadService } from './resume-upload.service';
import { S3_CLIENT } from './s3-client.provider';
import {
  experienceSchema,
  educationSchema,
  preferencesSchema,
  skillSchema,
  profileDetailsSchema,
  resumeNameSchema,
  seniorityValues,
} from './schemas/profile.schemas';

@Controller()
@UseGuards(AuthenticatedGuard)
export class ProfilesController {
  constructor(
    private readonly profilesService: ProfilesService,
    private readonly resumeUploadService: ResumeUploadService,
    @InjectQueue(PARSE_RESUME_QUEUE) private readonly parseResumeQueue: Queue,
    @InjectQueue(EMBED_PROFILE_QUEUE) private readonly embedProfileQueue: Queue,
    @Inject(S3_CLIENT) private readonly s3Client: S3Client,
    private readonly config: ConfigService,
  ) {}

  @Get('onboarding')
  @Render('profiles/onboarding')
  async onboarding(@Req() req: Request) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    if (this.profilesService.isOnboardingComplete(profile)) {
      return { profile, step: 5, seniorityValues, jobTypeValues: [] };
    }
    const step = Math.min(Math.max(profile.onboardingStep, 1), 4);
    return { profile, step, seniorityValues, jobTypeValues: [] };
  }

  @Get('onboarding/steps/:step')
  async onboardingStep(@Param('step') step: string, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const requested = Number(step);
    const allowed = Math.min(Math.max(requested, 1), 4);
    await this.renderStep(res, allowed, profile.id, { profile, returnTo: '/onboarding' });
  }

  @Post('onboarding/steps/:step')
  @HttpCode(HttpStatus.OK)
  async saveOnboardingStep(@Param('step') step: string, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const requested = Number(step);
    const allowed = Math.min(Math.max(requested, 1), 4);
    await this.profilesService.setOnboardingStep(profile.id, allowed);
    await this.renderStep(res, allowed, profile.id, { profile, returnTo: '/onboarding' });
  }

  @Post('onboarding/skip')
  @HttpCode(HttpStatus.OK)
  async skipOnboarding(@Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    await this.profilesService.setOnboardingStep(profile.id, 3);
    if (req.headers['hx-request']) {
      res.setHeader('HX-Redirect', '/onboarding/steps/3');
      res.sendStatus(200);
    } else {
      res.redirect('/onboarding/steps/3');
    }
  }

  @Post('onboarding/resume')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('resume'))
  async uploadResume(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    if (!file) {
      await this.renderStep(res, 1, profile.id, { profile, returnTo: '/onboarding', fieldErrors: { resume: 'Choose a CV file to upload' } });
      return;
    }
    try {
      const uploaded = await this.resumeUploadService.upload(file, user.id);
      const resume = await this.profilesService.addResume(profile.id, { fileName: file.originalname, ...uploaded, source: 'upload' });
      await this.profilesService.setParseStatus(profile.id, 'processing');
      await this.parseResumeQueue.add('parse', { profileId: profile.id, resumeId: resume.id });
      await this.renderStep(res, 2, profile.id, { profile: { ...profile, parseStatus: 'processing' }, returnTo: '/onboarding' });
    } catch (error) {
      res.status(422);
      await this.renderStep(res, 1, profile.id, { profile, returnTo: '/onboarding', fieldErrors: { resume: error instanceof Error ? error.message : 'Could not upload this file' } });
    }
  }

  @Get('onboarding/resume/status')
  async resumeStatus(@Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    if (profile.parseStatus === 'done') {
      await this.renderStep(res, 3, profile.id, { profile, returnTo: '/onboarding' });
      return;
    }
    await this.renderStep(res, 2, profile.id, { profile, returnTo: '/onboarding' });
  }

  @Post('onboarding/resume/retry')
  @HttpCode(HttpStatus.OK)
  async retryResume(@Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const [latest] = await this.profilesService.listResumes(profile.id);
    if (!latest) {
      await this.renderStep(res, 1, profile.id, { profile, returnTo: '/onboarding', fieldErrors: { resume: 'Upload a CV to get started' } });
      return;
    }
    await this.profilesService.setParseStatus(profile.id, 'processing');
    await this.parseResumeQueue.add('parse', { profileId: profile.id, resumeId: latest.id });
    await this.renderStep(res, 2, profile.id, { profile: { ...profile, parseStatus: 'processing' }, returnTo: '/onboarding' });
  }

  @Post('onboarding/experiences')
  @HttpCode(HttpStatus.OK)
  async addExperience(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const result = experienceSchema.safeParse(body);
    if (!result.success) {
      const experiences = await this.profilesService.listExperiences(profile.id);
      res.status(422).render('profiles/partials/experiences-list', { experiences, fieldErrors: flattenZodError(result.error), values: body, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
      return;
    }
    await this.profilesService.addExperience(profile.id, {
      ...result.data,
      location: result.data.location || undefined,
      startDate: result.data.startDate || undefined,
      endDate: result.data.endDate || undefined,
      description: result.data.description || undefined,
    });
    const experiences = await this.profilesService.listExperiences(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/experiences-list', { experiences, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Post('onboarding/experiences/:id')
  @HttpCode(HttpStatus.OK)
  async updateExperience(@Param('id') id: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const result = experienceSchema.safeParse(body);
    if (!result.success) {
      const experiences = await this.profilesService.listExperiences(profile.id);
      res.status(422).render('profiles/partials/experiences-list', { experiences, fieldErrors: flattenZodError(result.error), values: body, editingExperienceId: id, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
      return;
    }
    try {
      await this.profilesService.updateExperience(profile.id, id, {
        ...result.data,
        location: result.data.location || undefined,
        startDate: result.data.startDate || undefined,
        endDate: result.data.endDate || undefined,
        description: result.data.description || undefined,
      });
    } catch {
      res.status(422).render('profiles/partials/experiences-list', { experiences: await this.profilesService.listExperiences(profile.id), fieldErrors: { _root: 'Could not update this experience' }, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
      return;
    }
    const experiences = await this.profilesService.listExperiences(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/experiences-list', { experiences, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Post('onboarding/experiences/:id/move')
  @HttpCode(HttpStatus.OK)
  async moveExperience(@Param('id') id: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const direction = (body as Record<string, string> | undefined)?.direction === '-1' ? -1 : 1;
    await this.profilesService.reorderExperience(profile.id, id, direction);
    const experiences = await this.profilesService.listExperiences(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/experiences-list', { experiences, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Post('onboarding/experiences/:id/delete')
  @HttpCode(HttpStatus.OK)
  async deleteExperiencePost(@Param('id') id: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    await this.deleteExperience(id, req, res, body);
  }

  @Delete('onboarding/experiences/:id')
  async deleteExperienceDelete(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.deleteExperience(id, req, res);
  }

  private async deleteExperience(id: string, req: Request, res: Response, body?: unknown) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    await this.profilesService.removeExperience(profile.id, id);
    const experiences = await this.profilesService.listExperiences(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/experiences-list', { experiences, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Post('onboarding/educations')
  @HttpCode(HttpStatus.OK)
  async addEducation(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const result = educationSchema.safeParse(body);
    if (!result.success) {
      const educations = await this.profilesService.listEducations(profile.id);
      res.status(422).render('profiles/partials/educations-list', { educations, fieldErrors: flattenZodError(result.error), values: body, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
      return;
    }
    await this.profilesService.addEducation(profile.id, {
      ...result.data,
      degree: result.data.degree || undefined,
      fieldOfStudy: result.data.fieldOfStudy || undefined,
      startDate: result.data.startDate || undefined,
      endDate: result.data.endDate || undefined,
      description: result.data.description || undefined,
    });
    const educations = await this.profilesService.listEducations(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/educations-list', { educations, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Post('onboarding/educations/:id')
  @HttpCode(HttpStatus.OK)
  async updateEducation(@Param('id') id: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const result = educationSchema.safeParse(body);
    if (!result.success) {
      const educations = await this.profilesService.listEducations(profile.id);
      res.status(422).render('profiles/partials/educations-list', { educations, fieldErrors: flattenZodError(result.error), values: body, editingEducationId: id, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
      return;
    }
    try {
      await this.profilesService.updateEducation(profile.id, id, {
        ...result.data,
        degree: result.data.degree || undefined,
        fieldOfStudy: result.data.fieldOfStudy || undefined,
        startDate: result.data.startDate || undefined,
        endDate: result.data.endDate || undefined,
        description: result.data.description || undefined,
      });
    } catch {
      res.status(422).render('profiles/partials/educations-list', { educations: await this.profilesService.listEducations(profile.id), fieldErrors: { _root: 'Could not update this education' }, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
      return;
    }
    const educations = await this.profilesService.listEducations(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/educations-list', { educations, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Post('onboarding/educations/:id/move')
  @HttpCode(HttpStatus.OK)
  async moveEducation(@Param('id') id: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const direction = (body as Record<string, string> | undefined)?.direction === '-1' ? -1 : 1;
    await this.profilesService.reorderEducation(profile.id, id, direction);
    const educations = await this.profilesService.listEducations(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/educations-list', { educations, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Post('onboarding/educations/:id/delete')
  @HttpCode(HttpStatus.OK)
  async deleteEducationPost(@Param('id') id: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    await this.deleteEducation(id, req, res, body);
  }

  @Delete('onboarding/educations/:id')
  async deleteEducationDelete(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.deleteEducation(id, req, res);
  }

  private async deleteEducation(id: string, req: Request, res: Response, body?: unknown) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    await this.profilesService.removeEducation(profile.id, id);
    const educations = await this.profilesService.listEducations(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/educations-list', { educations, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Get('skills/suggest')
  async suggestSkills(@Query('q') q: string | undefined, @Res() res: Response) {
    const suggestions = await this.profilesService.suggestSkills(q ?? '');
    res.render('profiles/partials/skill-suggestions', { suggestions });
  }

  @Post('onboarding/skills')
  @HttpCode(HttpStatus.OK)
  async addSkill(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const name = (body as Record<string, string> | undefined)?.name || (body as Record<string, string> | undefined)?.q;
    const result = skillSchema.safeParse({ name });
    if (!result.success) {
      const profileSkills = await this.profilesService.listProfileSkills(profile.id);
      res.status(422).render('profiles/partials/skill-chips', { profileSkills, fieldErrors: flattenZodError(result.error), returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
      return;
    }
    const profileSkills = await this.profilesService.addSkill(profile.id, result.data.name);
    if (req.headers['hx-request']) res.render('profiles/partials/skill-chips', { profileSkills, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Post('onboarding/skills/:skillId/delete')
  @HttpCode(HttpStatus.OK)
  async deleteSkillPost(@Param('skillId') skillId: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    await this.deleteSkill(skillId, req, res, body);
  }

  @Delete('onboarding/skills/:skillId')
  async deleteSkillDelete(@Param('skillId') skillId: string, @Req() req: Request, @Res() res: Response) {
    await this.deleteSkill(skillId, req, res);
  }

  private async deleteSkill(skillId: string, req: Request, res: Response, body?: unknown) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const profileSkills = await this.profilesService.removeSkill(profile.id, skillId);
    if (req.headers['hx-request']) res.render('profiles/partials/skill-chips', { profileSkills, returnTo: safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo) });
    else res.redirect(safeReturnTo((body as Record<string, unknown> | undefined)?.returnTo));
  }

  @Post('onboarding/preferences')
  @HttpCode(HttpStatus.OK)
  async savePreferences(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const result = preferencesSchema.safeParse(body);
    if (!result.success) {
      res.status(422).render('profiles/partials/onboarding-step-4', { profile, values: body, fieldErrors: flattenZodError(result.error), returnTo: '/onboarding', jobTypeValues: [], seniorityValues: [] });
      return;
    }
    await this.profilesService.updatePreferences(profile.id, result.data);
    await this.profilesService.markOnboardingComplete(profile.id);
    if (req.headers['hx-request']) {
      res.setHeader('HX-Redirect', '/matches');
      res.sendStatus(200);
    } else {
      res.redirect('/matches');
    }
  }

  @Post('onboarding/steps/4')
  @HttpCode(HttpStatus.OK)
  async onboardingPreferences(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    await this.savePreferences(body, req, res);
  }

  @Get('profile')
  @Render('profiles/profile')
  async profilePage(@Req() req: Request) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const full = await this.profilesService.findFullProfile(profile.id);
    return {
      profile: full,
      seniorityValues,
      jobTypeValues: [],
      completeness: full ? this.profilesService.profileCompleteness(full) : 0,
    };
  }

  @Post('profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const result = profileDetailsSchema.safeParse(body);
    if (!result.success) {
      const full = await this.profilesService.findFullProfile(profile.id);
      res.status(422).render('profiles/partials/profile-summary', { profile: full, values: body, fieldErrors: flattenZodError(result.error), seniorityValues, completeness: full ? this.profilesService.profileCompleteness(full) : 0 });
      return;
    }
    await this.profilesService.updateDetails(profile.id, result.data);
    const full = await this.profilesService.findFullProfile(profile.id);
    if (req.headers['hx-request']) {
      res.render('profiles/partials/profile-summary', { profile: full, seniorityValues, completeness: full ? this.profilesService.profileCompleteness(full) : 0 });
    } else {
      res.redirect('/profile');
    }
  }

  @Post('profile/preferences')
  @HttpCode(HttpStatus.OK)
  async updateProfilePreferences(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const result = preferencesSchema.safeParse(body);
    if (!result.success) {
      const full = await this.profilesService.findFullProfile(profile.id);
      res.status(422).render('profiles/partials/onboarding-step-4', { profile: full, values: body, fieldErrors: flattenZodError(result.error), embedded: true, preferencesAction: '/profile/preferences', preferencesTarget: '#profile-preferences', buttonLabel: 'Save preferences', jobTypeValues: [], seniorityValues });
      return;
    }
    await this.profilesService.updatePreferences(profile.id, result.data);
    const full = await this.profilesService.findFullProfile(profile.id);
    if (req.headers['hx-request']) {
      res.render('profiles/partials/onboarding-step-4', { profile: full, embedded: true, preferencesAction: '/profile/preferences', preferencesTarget: '#profile-preferences', buttonLabel: 'Save preferences', jobTypeValues: [], seniorityValues });
    } else {
      res.redirect('/profile');
    }
  }

  @Post('profile/resumes')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('resume'))
  async addProfileResume(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    if (!file) {
      const resumes = await this.profilesService.listResumes(profile.id);
      res.status(422).render('profiles/partials/resumes-list', { resumes, fieldErrors: { resume: 'Choose a CV file to upload' } });
      return;
    }
    try {
      const uploaded = await this.resumeUploadService.upload(file, user.id);
      await this.profilesService.addResume(profile.id, { fileName: file.originalname, ...uploaded, source: 'upload' });
      await this.profilesService.setParseStatus(profile.id, 'processing');
      const resumes = await this.profilesService.listResumes(profile.id);
      const [latest] = resumes;
      await this.parseResumeQueue.add('parse', { profileId: profile.id, resumeId: latest.id });
    } catch (error) {
      const resumes = await this.profilesService.listResumes(profile.id);
      res.status(422).render('profiles/partials/resumes-list', { resumes, fieldErrors: { resume: error instanceof Error ? error.message : 'Could not upload this file' } });
      return;
    }
    const resumes = await this.profilesService.listResumes(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/resumes-list', { resumes });
    else res.redirect('/profile');
  }

  @Post('profile/resumes/:id/primary')
  @HttpCode(HttpStatus.OK)
  async setPrimaryResume(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const resumes = await this.profilesService.setPrimaryResume(profile.id, id);
    if (req.headers['hx-request']) res.render('profiles/partials/resumes-list', { resumes });
    else res.redirect('/profile');
  }

  @Post('profile/resumes/:id/delete')
  @HttpCode(HttpStatus.OK)
  async removeResumePost(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.removeResume(id, req, res);
  }

  @Delete('profile/resumes/:id')
  async removeResumeDelete(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    await this.removeResume(id, req, res);
  }

  private async removeResume(id: string, req: Request, res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const [resume] = await this.profilesService.listResumes(profile.id).then((items) => items.filter((item) => item.id === id));
    if (resume) await this.resumeUploadService.delete(resume.s3Key).catch(() => undefined);
    const resumes = await this.profilesService.removeResume(profile.id, id);
    if (req.headers['hx-request']) res.render('profiles/partials/resumes-list', { resumes });
    else res.redirect('/profile');
  }

  @Post('profile/resumes/:id/name')
  @HttpCode(HttpStatus.OK)
  async renameResume(@Param('id') id: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const result = resumeNameSchema.safeParse(body);
    if (!result.success) {
      const resumes = await this.profilesService.listResumes(profile.id);
      res.status(422).render('profiles/partials/resumes-list', { resumes, fieldErrors: flattenZodError(result.error) });
      return;
    }
    try {
      const resumes = await this.profilesService.renameResume(profile.id, id, result.data.fileName);
      if (req.headers['hx-request']) res.render('profiles/partials/resumes-list', { resumes });
      else res.redirect('/profile');
    } catch {
      const resumes = await this.profilesService.listResumes(profile.id);
      res.status(422).render('profiles/partials/resumes-list', { resumes, fieldErrors: { _root: 'Could not rename this resume' } });
    }
  }

  @Post('profile/resumes/:id/retry')
  @HttpCode(HttpStatus.OK)
  async retryProfileResume(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const [resume] = (await this.profilesService.listResumes(profile.id)).filter((item) => item.id === id);
    if (!resume) {
      const resumes = await this.profilesService.listResumes(profile.id);
      res.status(422).render('profiles/partials/resumes-list', { resumes, fieldErrors: { _root: 'Resume not found' } });
      return;
    }
    await this.profilesService.setParseStatus(profile.id, 'processing');
    await this.parseResumeQueue.add('parse', { profileId: profile.id, resumeId: resume.id });
    const resumes = await this.profilesService.listResumes(profile.id);
    if (req.headers['hx-request']) res.render('profiles/partials/resumes-list', { resumes });
    else res.redirect('/profile');
  }

  @Get('profile/resumes/:id/download')
  async downloadResume(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const user = currentUser(req);
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const [resume] = (await this.profilesService.listResumes(profile.id)).filter((item) => item.id === id);
    if (!resume) {
      res.status(404).render('errors/404');
      return;
    }
    const url = await getSignedUrl(this.s3Client, new GetObjectCommand({ Bucket: this.config.getOrThrow<string>('S3_BUCKET'), Key: resume.s3Key }), { expiresIn: 300 });
    res.redirect(url);
  }

  private async renderStep(res: Response, step: number, profileId: string, extras: Record<string, unknown> = {}) {
    const profile = await this.profilesService.findFullProfile(profileId);
    if (step === 3) {
      const [experiences, educations, profileSkills] = await Promise.all([
        this.profilesService.listExperiences(profileId),
        this.profilesService.listEducations(profileId),
        this.profilesService.listProfileSkills(profileId),
      ]);
      res.render('profiles/partials/onboarding-step-3', { profile, experiences, educations, profileSkills, seniorityValues, ...extras });
      return;
    }
    if (step === 4) {
      res.render('profiles/partials/onboarding-step-4', { profile, jobTypeValues: [], seniorityValues, ...extras });
      return;
    }
    res.render(`profiles/partials/onboarding-step-${step}`, { profile, seniorityValues, ...extras });
  }
}

function currentUser(req: Request): User {
  return req.user as User;
}

function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    return '/profile';
  }
  try {
    const url = new URL(value, 'http://job-copilot.local');
    return url.origin === 'http://job-copilot.local' ? value : '/profile';
  } catch {
    return '/profile';
  }
}

function flattenZodError(error: { issues: Array<{ path: (string | number)[]; message: string }> }): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}
