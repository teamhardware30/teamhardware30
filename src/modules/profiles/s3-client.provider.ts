import { S3Client } from '@aws-sdk/client-s3';
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const S3_CLIENT = Symbol('S3_CLIENT');

export const s3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): S3Client => new S3Client({ region: config.get<string>('AWS_REGION') }),
};
