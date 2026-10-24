import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { EmbeddingProviderFactory } from './embedding-provider';

@Module({
  providers: [AiService, EmbeddingProviderFactory],
  exports: [AiService],
})
export class AiModule {}
