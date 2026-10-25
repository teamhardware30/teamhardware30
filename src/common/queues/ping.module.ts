import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PING_QUEUE } from './ping.constants';
import { PingProcessor } from './ping.processor';

@Module({
  imports: [BullModule.registerQueue({ name: PING_QUEUE })],
  providers: [PingProcessor],
})
export class PingModule {}
