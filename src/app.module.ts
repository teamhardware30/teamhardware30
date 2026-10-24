import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './common/config/env.schema';
import { DbModule } from './db/db.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { CrawlerModule } from './modules/crawler/crawler.module';
import { MatchingModule } from './modules/matching/matching.module';
import { AtsModule } from './modules/ats/ats.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AiModule } from './modules/ai/ai.module';
import { AdminModule } from './modules/admin/admin.module';
import { WebModule } from './modules/web/web.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      // In tests, env vars are set programmatically (e.g. ephemeral
      // Testcontainers ports) — a real .env file on disk must not win
      // over those.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
    }),
    ScheduleModule.forRoot(),
    DbModule,
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
    WebModule,
  ],
})
export class AppModule {}
