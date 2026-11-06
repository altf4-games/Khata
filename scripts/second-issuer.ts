// A second, independent lender checking an investor with no integration with Khata or with the attester.
// It needs only the public Arkiv schema (web/src/arkiv.ts), the attester registry's address and a Whitechain RPC.
// Run: npx tsx scripts/second-issuer.ts <wallet address>
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { arkivClients, findCredentials, findRevocations, verifyCredential, verifyRevocation } from "../web/src/arkiv";
import { decide } from "./lib/lender";
// @ts-expect-error plain ESM helper
import { deployment, loadEnv, whitechainSepolia } from "./lib/chain.mjs";

const who = process.argv[2] as Address | undefined;
if (!who || !/^0x[0-9a-fA-F]{40}$/.test(who)) {
  console.error("usage: npx tsx scripts/second-issuer.ts <wallet address>");
  process.exit(2);
}
const dep = deployment().stage2;
const wc = createPublicClient({ chain: whitechainSepolia, transport: http() });
const abi = parseAbi([
  "function isAttester(address) view returns (bool)",
  "function eligibility(address) view returns (uint8,uint8)",
  "function isRevoked(address,bytes32) view returns (bool)",
]);
const domain = { name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: dep.AttesterRegistry } as const;
const now = Number((await wc.getBlock()).timestamp);

const ark = arkivClients({ accessKey: loadEnv().ARKIV_ACCESS_KEY, transport: http() });
const found = await findCredentials(ark.pub, { subject: who, notBefore: now });
console.log(`Arkiv holds ${found.length} unexpired credential(s) for ${who}`);
let accepted = 0;
for (const c of found) {
  const checked = await verifyCredential(c, { domain, now, isAttester: async (a) => (await wc.readContract({ address: dep.AttesterRegistry, abi, functionName: "isAttester", args: [a] })) as boolean });
  // a revocation counts only when its own attester signed and published it, on Arkiv or on Whitechain
  const revs = await findRevocations(ark.pub, { attester: c.attester, credId: c.credId });
  const onArkiv = (await Promise.all(revs.map((r) => verifyRevocation(r, { domain })))).some((x) => x.ok);
  const onChain = (await wc.readContract({ address: dep.AttesterRegistry, abi, functionName: "isRevoked", args: [c.attester, c.credId] })) as boolean;
  const v = decide(checked, onArkiv, onChain);
  console.log(`  ${c.credId.slice(0, 12)}…  tier ${c.tier}  expires ${new Date(c.validUntil * 1000).toISOString()}  from ${c.attester}  ->`, v.ok ? "ACCEPTED" : `rejected: ${v.reason}`);
  if (v.ok) accepted++;
}
const [reason] = (await wc.readContract({ address: dep.AttesterRegistry, abi, functionName: "eligibility", args: [who] })) as [number, number];
console.log(accepted > 0 ? "Decision: this lender accepts the investor, using the attester's Arkiv credential and no other integration." : "Decision: no acceptable credential on Arkiv.");
console.log(`(Whitechain's own view of the wallet: ${["Eligible", "NoCredential", "Expired", "Revoked", "AttesterRemoved"][reason]})`);
