// A record of the Arkiv queries the app makes, in words, so a screen can show how it uses Arkiv. Not a log of results.
export interface TraceEntry { at: number; entity: string; where: string; why: string }
const LIMIT = 30;
const entries: TraceEntry[] = [];

export function trace(entity: string, where: string, why: string, at = Date.now()) {
  const last = entries[entries.length - 1];
  if (last && last.entity === entity && last.where === where && at - last.at < 1000) return; // a burst of the same query is one line
  entries.push({ at, entity, where, why });
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
}
export const arkivTrace = (): readonly TraceEntry[] => entries;
export const clearTrace = () => { entries.length = 0; };
