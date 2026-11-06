// Counts the app's RPC traffic so the share going through Anon-RPC can be shown and checked.
// A "read" is any JSON-RPC call except broadcasting a signed transaction. Broadcasts reveal the sender by nature
// and the one bootstrap read (which worker to trust) carries no user data; both are counted apart, never hidden.
export type Route = "anon" | "direct";
export type Excluded = "broadcast" | "bootstrap";

export type LogRoute = Route | "broadcast" | "bootstrap";
export interface LogEntry { at: number; route: LogRoute; methods: string[]; ms: number; ok: boolean }
const LOG_LIMIT = 200;

export class Traffic {
  private entries: LogEntry[] = [];
  private n = { anon: 0, direct: 0, broadcast: 0, bootstrap: 0, failed: 0 };

  read(route: Route, calls = 1) {
    this.n[route] += calls;
  }
  excluded(kind: Excluded, calls = 1) {
    this.n[kind] += calls;
  }
  failed(calls = 1) {
    this.n.failed += calls;
  }
  /** Fraction of reads that went through Anon-RPC, or undefined while nothing has been read (no claim yet). */
  share(): number | undefined {
    const total = this.n.anon + this.n.direct;
    return total === 0 ? undefined : this.n.anon / total;
  }
  /** One line per request, newest last, so a visitor (or a test) can see exactly what went where. */
  record(e: Omit<LogEntry, "at"> & { at?: number }) {
    this.entries.push({ at: e.at ?? Date.now(), route: e.route, methods: e.methods, ms: e.ms, ok: e.ok });
    if (this.entries.length > LOG_LIMIT) this.entries.splice(0, this.entries.length - LOG_LIMIT);
  }
  log(): readonly LogEntry[] {
    return this.entries;
  }
  /** Reads that did not go through Anon-RPC: empty means every read was private. */
  directReads(): LogEntry[] {
    return this.entries.filter((e) => e.route === "direct");
  }
  snapshot() {
    return { ...this.n };
  }
}
