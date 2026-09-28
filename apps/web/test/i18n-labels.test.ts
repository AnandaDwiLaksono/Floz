import { describe, expect, it } from 'vitest';
import { formatDateDisplay, formatStatusName, formatTransitionLabel } from '../lib/i18n-labels';

describe('i18n presentation labels', () => {
  it('keeps API labels untouched while localizing display text and SQL timestamps', () => {
    expect(formatStatusName('To do')).toBe('Belum dimulai');
    expect(formatTransitionLabel('In progress')).toBe('Mulai dikerjakan');
    expect(formatDateDisplay('2026-09-25 02:30:00+00')).toBe('25 Sep 2026');
  });
});
