import { describe, expect, test } from 'vitest';
import { applyRetention, selectRetention } from '../backup/retention.mjs';

const archive = (id: string, day: number, successful = true, verified = true) => ({ id, successful, verified, snapshotStartedAt: new Date(Date.UTC(2026, 7, day)).toISOString() });

describe('retention', () => {
  test('keeps exact daily and weekly union without duplicate deletion', () => {
    const selected = selectRetention(Array.from({ length: 31 }, (_, i) => archive(String(i), 31 - i)));
    expect(selected.filter((x) => x.classes.includes('daily'))).toHaveLength(7);
    expect(new Set(selected.filter((x) => x.classes.includes('weekly')).map((x) => x.week))).toHaveLength(4);
  });

  test('deletes only after verified replacement and stops on deletion failure', async () => {
    const deleted: string[] = [];
    await expect(applyRetention([archive('new', 31), archive('old', 1)], { replacement: archive('failed', 31, false), deleteArchive: async (id: string) => { deleted.push(id); throw new Error('delete failed'); } })).resolves.toEqual([]);
    expect(deleted).toEqual([]);
    await expect(applyRetention(Array.from({ length: 12 }, (_, i) => archive(String(i), 31 - i)), { replacement: archive('replacement', 31), deleteArchive: async (id: string) => { deleted.push(id); if (deleted.length === 2) throw new Error('delete failed'); } })).rejects.toThrow('delete failed');
    expect(deleted).toHaveLength(2);
  });
});
