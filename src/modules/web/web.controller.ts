import { Controller, Get, Render, Req } from '@nestjs/common';
import { Request } from 'express';
import { MatchingService } from '../matching/matching.service';
import { ProfilesService } from '../profiles/profiles.service';

@Controller()
export class WebController {
  constructor(private readonly profilesService: ProfilesService, private readonly matchingService: MatchingService) {}

  @Get()
  @Render('web/home')
  async home(@Req() req: Request) {
    const user = req.user as { id: string; role?: string } | undefined;
    if (!user || user.role !== 'seeker') {
      return { user: user ?? null, newMatches: 0 };
    }
    const profile = await this.profilesService.getOrCreateForUser(user.id);
    const newMatches = await this.matchingService.countNewSince(profile.id, profile.lastMatchesViewedAt);
    return { user, newMatches };
  }
}
