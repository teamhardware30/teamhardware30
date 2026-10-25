import { Module } from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { WebController } from './web.controller';

@Module({
  imports: [forwardRef(() => ProfilesModule), forwardRef(() => MatchingModule)],
  controllers: [WebController],
})
export class WebModule {}
