import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AuthenticatedGuard } from '../src/modules/auth/guards/authenticated.guard';
import { DataRightsController } from '../src/modules/users/data-rights.controller';

describe('DataRightsController guards', () => {
  it('serves the legal pages without requiring a session', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DataRightsController)).toBeUndefined();
  });

  it('still protects account export and deletion', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DataRightsController.prototype.export)).toEqual([AuthenticatedGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, DataRightsController.prototype.delete)).toEqual([AuthenticatedGuard]);
  });
});
