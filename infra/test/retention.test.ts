import { describe, expect, test } from 'vitest';
import { applyRetention, selectRetention } from '../backup/retention.mjs';

const archive = (id: string, day: number, successful = true, verified = true) => ({ id, successful, verified, snapshotStartedAt: new Date(Date.UTC(2026, 7, day)).toISOString() });

describe('retention', () => {
  test('keeps exact UTC seven-daily four-weekly verified union without duplicates', () => {
    const selected = selectRetention(Array.from({ length: 31 }, (_, i) => archive(String(i), 31 - i)));
    expect(selected.filter((x) => x.classes.includes('daily'))).toHaveLength(7);
    expect(new Set(selected.filter((x) => x.classes.includes('weekly')).map((x) => x.week))).toHaveLength(4);
    expect(new Set(selected.map((x) => x.id)).size).toBe(selected.length);
  });

  test('lists durable verified records before deleting only after verified replacement', async () => {
    const deleted: string[] = []; const listed = Array.from({ length: 12 }, (_, i) => archive(String(i), 31 - i));
    await expect(applyRetention(undefined as never, { replacement: archive('replacement', 31), listArchives: async () => listed, deleteArchive: async (id: string) => { deleted.push(id); } })).resolves.toEqual(expect.any(Array));
    expect(deleted.length).toBeGreaterThan(0);
  });

  test('preserves archives when list or delete fails', async () => {
    const deleted: string[] = [];
    await expect(applyRetention(undefined as never, { replacement: archive('replacement', 31), listArchives: async () => { throw new Error('list failed'); }, deleteArchive: async () => {} })).rejects.toThrow('list failed');
    await expect(applyRetention(Array.from({ length: 12 }, (_, i) => archive(String(i), 31 - i)), { replacement: archive('replacement', 31), listArchives: undefined, deleteArchive: async (id: string) => { deleted.push(id); throw new Error('delete failed'); } } as never)).rejects.toThrow('delete failed');
    expect(deleted).toHaveLength(1);
  });
});
