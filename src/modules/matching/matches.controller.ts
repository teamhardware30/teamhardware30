import { Body, Controller, Get, Param, Patch, Query, Render, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../db/schema';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard';
import { MatchExplanationService } from './explain.service';
import { MatchingService } from './matching.service';

@Controller('matches')
@UseGuards(AuthenticatedGuard)
export class MatchesController {
  constructor(private readonly matchingService: MatchingService, private readonly explanationService: MatchExplanationService) {}

  @Get()
  @Render('matches/index')
  async index(@CurrentUser() user: User, @Query() query: Record<string, string>) {
    const profileId = await this.matchingService.getProfileIdForUser(user.id);
    const matches = await this.matchingService.listMatches(profileId, {
      status: query.status || 'all',
      category: query.category,
      remote: query.remote === 'true',
      minScore: query.minScore && Number.isFinite(Number(query.minScore)) ? Number(query.minScore) : undefined,
    });
    await this.matchingService.markMatchesViewed(profileId);
    return { matches, filters: query };
  }

  @Patch(':id/status')
  async updateStatus(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Record<string, string>, @Res() res: Response) {
    const profileId = await this.matchingService.getProfileIdForUser(user.id);
    const status = (body.status as 'new' | 'saved' | 'hidden' | 'applied') || 'new';
    await this.matchingService.setStatus(profileId, id, status);
    const match = await this.matchingService.getMatch(profileId, id);
    res.render('matches/partials/card', { match });
  }

  @Get(':id/panel')
  async panel(@CurrentUser() user: User, @Param('id') id: string, @Res() res: Response) {
    const profileId = await this.matchingService.getProfileIdForUser(user.id);
    const match = await this.matchingService.getMatch(profileId, id);
    res.render('matches/partials/panel', { match });
  }

  @Get(':id/explanation')
  async explanation(@CurrentUser() user: User, @Param('id') id: string, @Res() res: Response) {
    const profileId = await this.matchingService.getProfileIdForUser(user.id);
    const explanation = await this.explanationService.explain(profileId, id);
    res.render('matches/partials/explanation', { explanation });
  }
}
