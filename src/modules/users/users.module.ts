import { Module } from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module';
import { s3ClientProvider } from '../profiles/s3-client.provider';
import { DataRightsController } from './data-rights.controller';
import { DataRightsService } from './data-rights.service';
import { UsersService } from './users.service';

@Module({
  imports: [forwardRef(() => ProfilesModule)],
  controllers: [DataRightsController],
  exports: [UsersService, DataRightsService],
  providers: [UsersService, DataRightsService, s3ClientProvider],
})
export class UsersModule {}
