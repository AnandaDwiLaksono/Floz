import { describe, expect, test } from 'vitest';
import { selectRetention } from '../backup/retention.mjs';

const item = (id: string, day: number, successful = true, verified = true) => ({ id, successful, verified, snapshotStartedAt: new Date(Date.UTC(2026, 7, day)).toISOString() });

describe('retention', () => {
  test('keeps union of seven UTC daily and four UTC weekly successful verified archives', () => {
    const selected = selectRetention(Array.from({ length: 31 }, (_, i) => item(String(i), 31 - i)));
    expect(selected.filter((x) => x.classes.includes('daily'))).toHaveLength(7);
    expect(new Set(selected.filter((x) => x.classes.includes('weekly')).map((x) => x.week))).toHaveLength(4);
    expect(new Set(selected.map((x) => x.id)).size).toBe(selected.length);
  });

  test('failed and unverified attempts never displace usable archives', () => {
    expect(selectRetention([item('failed', 31, false), item('unverified', 30, true, false), item('good', 29)]).map((x) => x.id)).toEqual(['good']);
  });
});
