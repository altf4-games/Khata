// Read-only: how many live Khata entities Arkiv holds right now, by type and by the wallet that wrote them. This is the number the
// Reach write-up quotes, so anyone can re-run it. Nothing is written. Usage: npx tsx scripts/arkiv-reach.ts
import { http } from "viem";
import { asc, gt } from "@arkiv-network/sdk/query";
import { key as keyValue } from "@arkiv-network/sdk/schema";
import { arkivClients, Credential, Heartbeat, Listing, Revocation } from "../web/src/arkiv";
// @ts-expect-error plain ESM helper
import { loadEnv, wallet } from "./lib/chain.mjs";
import demoWallets from "../deployments/demo-wallets.json" with { type: "json" };

const ark = arkivClients({ accessKey: loadEnv().ARKIV_ACCESS_KEY, transport: http() });
const names = new Map<string, string>(demoWallets.map((w: { id: string; address: string }) => [w.address.toLowerCase(), w.id]));
const PAGES = 10; // 1000 entities per type at most; the public endpoint caps a page at 100

async function count(schema: unknown, label: string) {
  const owners = new Map<string, number>();
  let cursor: string | undefined;
  let total = 0;
  for (let p = 0; p < PAGES; p++) {
    const q = (ark.pub.select({ $key: true, $owner: true }).from(schema as never) as any);
    const res = await (cursor ? q.where(gt("$key", keyValue(cursor as never))) : q.where(gt("$key", keyValue("0x" + "00".repeat(32) as never)))).orderBy(asc("$key")).limit(100).fetch();
    for (const e of res.entities) { owners.set(e.$owner.toLowerCase(), (owners.get(e.$owner.toLowerCase()) ?? 0) + 1); total++; }
    const skipped = res.skipped ?? 0;
    if (res.entities.length + skipped < 100) break;
    cursor = res.entities.length ? res.entities[res.entities.length - 1].$key : undefined;
    if (!cursor) break;
  }
  console.log(`${label.padEnd(18)} ${String(total).padStart(4)} live${total >= PAGES * 100 ? " (at least)" : ""}`);
  for (const [o, n] of [...owners].sort((a, b) => b[1] - a[1])) console.log(`    ${o}  ${String(n).padStart(4)}  ${names.get(o) ?? "(not one of the labelled demo wallets)"}`);
  return total;
}

console.log(`Live entities on Arkiv Rabdi at ${new Date().toISOString()} (chain ${ark.chain.id})`);
let all = 0;
for (const [s, l] of [[Credential, "khata.credential"], [Revocation, "khata.revocation"], [Listing, "khata.listing"], [Heartbeat, "khata.heartbeat"]] as const) all += await count(s, l);
console.log(`total ${all}`);
