import { Module } from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { MailModule } from '../../common/mail/mail.module';
import { AiModule } from '../ai/ai.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { ApplicationsController } from './applications.controller';
import { ApplyService } from './apply.service';
import { EmployerController } from './employer.controller';

@Module({
  imports: [forwardRef(() => ProfilesModule), JobsModule, AiModule, MailModule, UsersModule],
  controllers: [ApplicationsController, EmployerController],
  providers: [ApplyService],
  exports: [ApplyService],
})
export class ApplicationsModule {}
