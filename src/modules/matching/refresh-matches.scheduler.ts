import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MatchingService } from './matching.service';

@Injectable()
export class RefreshMatchesScheduler {
  private readonly logger = new Logger(RefreshMatchesScheduler.name);

  constructor(private readonly matchingService: MatchingService) {}

  @Cron('0 2 * * *')
  async refresh(): Promise<void> {
    await this.matchingService.refreshAll();
    this.logger.log('Nightly match refresh completed');
  }
}
