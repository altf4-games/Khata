// The attester's heartbeat: a short-lived Arkiv entity the attester keeps renewing while it is running. Arkiv deletes an entity
// when its expiry passes, so a silent attester disappears from the query by itself: no cleanup job, no "last seen" column to trust.
export const HEARTBEAT_SECONDS = 600;

export type Beat = { seq: number; owner: string; attester: string };
export type BeatStatus = { state: "none" } | { state: "live"; seq: number; renewsInSeconds: number };

/**
 * `found` is what the query returned: Arkiv has already dropped expired entities. The owner must be the attester it names, so a
 * stranger cannot write a heartbeat for someone else; anything else counts as no heartbeat.
 */
export function heartbeatStatus(found: Beat[], attester: string, ageOf: (seq: number) => number): BeatStatus {
  // `seq` is the unix time the heartbeat was sent, so ageOf(seq) is now - seq
  const mine = found.filter((b) => b.attester.toLowerCase() === attester.toLowerCase() && b.owner.toLowerCase() === attester.toLowerCase());
  if (!mine.length) return { state: "none" };
  const latest = mine.reduce((a, b) => (b.seq > a.seq ? b : a));
  return { state: "live", seq: latest.seq, renewsInSeconds: Math.max(0, HEARTBEAT_SECONDS - ageOf(latest.seq)) };
}
