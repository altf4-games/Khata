// The evidence files (deployments/evidence*.json) list transactions the live suites sent. Some steps run only once per
// deployment (the first bind of the NIC sample, seller registration), so each run merges into the file instead of
// replacing it: a step's newest transaction wins, steps this run skipped keep their earlier transaction, and a new
// deployment (a different registry) starts the list again.

/** @param {any} old the current file, or undefined  @param {Record<string, unknown>} header  @param {{label:string,hash:string,status:string,reason?:string}[]} txs */
export function mergeEvidence(old, header, txs) {
  const keep = old && old.KhataRegistry === header.KhataRegistry ? old.entries : [];
  const byLabel = new Map(keep.map((e) => [e.label, e]));
  for (const { label, hash, status, reason } of txs) byLabel.set(label, reason ? { label, hash, status, reason } : { label, hash, status });
  return { ...header, entries: [...byLabel.values()] };
}
