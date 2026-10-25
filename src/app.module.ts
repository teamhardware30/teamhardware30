import { Module } from '@nestjs/common';
import { PingModule } from './common/queues/ping.module';
import { CoreModule } from './core.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AtsModule } from './modules/ats/ats.module';
import { AuthModule } from './modules/auth/auth.module';
import { CrawlerModule } from './modules/crawler/crawler.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MatchingModule } from './modules/matching/matching.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { UsersModule } from './modules/users/users.module';
import { WebModule } from './modules/web/web.module';

@Module({
  imports: [
    CoreModule,
    PingModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    JobsModule,
    CrawlerModule,
    MatchingModule,
    AtsModule,
    ApplicationsModule,
    AiModule,
    AdminModule,
    HealthModule,
    WebModule,
  ],
})
export class AppModule {}
