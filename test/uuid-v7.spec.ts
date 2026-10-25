import { describe, expect, it } from 'vitest';
import { uuidV7 } from '../src/common/db/uuid-v7';

describe('uuidV7', () => {
  it('generates a version 7 UUID with the encoded timestamp', () => {
    const timestamp = 0x0123_4567_89ab;
    const id = uuidV7(timestamp);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(timestamp);
  });

  it('generates unique IDs', () => {
    expect(new Set(Array.from({ length: 1_000 }, () => uuidV7())).size).toBe(1_000);
  });

  it('rejects invalid timestamps', () => {
    expect(() => uuidV7(-1)).toThrow(RangeError);
    expect(() => uuidV7(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => uuidV7(0x1_0000_0000_0000)).toThrow(RangeError);
  });
});
