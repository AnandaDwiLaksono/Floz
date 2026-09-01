function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}
function zonedMidnight(value: string, timeZone: string) {
  const [year, month, day] = value.split('-').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day));
  const offset = dateParts(guess, timeZone).timeZoneName.replace('GMT', '') || '+00:00';
  return `${value}T00:00:00.000${offset}`;
}
function nextDate(value: string) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
export function reportingPeriod(from: string, to: string, timeZone: string) { return { from: zonedMidnight(from, timeZone), to: zonedMidnight(nextDate(to), timeZone) }; }
