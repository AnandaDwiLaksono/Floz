function parts(date: Date, timeZone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(date).map(({ type, value }) => [type, value]));
}
function offsetAt(date: Date, timeZone: string) { return parts(date, timeZone).timeZoneName.replace('GMT', '') || '+00:00'; }
function target(value: string, timeZone: string) {
  let instant = new Date(`${value}T00:00:00.000Z`);
  for (let i = 0; i < 3; i++) instant = new Date(`${value}T00:00:00.000${offsetAt(instant, timeZone)}`);
  return { value, instant, localDate: `${parts(instant, timeZone).year}-${parts(instant, timeZone).month}-${parts(instant, timeZone).day}` };
}
function addDay(value: string) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }
function zonedMidnight(value: string, timeZone: string) {
  let result = target(value, timeZone);
  while (result.localDate < value) result = target(addDay(result.value), timeZone);
  return `${result.value}T00:00:00.000${offsetAt(result.instant, timeZone)}`;
}
export function reportingPeriod(from: string, to: string, timeZone: string) { return { from: zonedMidnight(from, timeZone), to: zonedMidnight(addDay(to), timeZone) }; }
export function reportingDefaults(timeZone: string, now = new Date()) { const p = parts(now, timeZone); const today = `${p.year}-${p.month}-${p.day}`; return { from: `${p.year}-${p.month}-01`, to: today }; }
