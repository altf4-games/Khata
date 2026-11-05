// Arkiv (Rabdi) balances of the demo wallets. Prints addresses and tGLM only.
import { createPublicClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, formatEther } from "viem";
import { loadEnv, wallet } from "./lib/chain.mjs";
const env = loadEnv();
const c = createPublicClient({ chain: rabdi({ accessKey: env.ARKIV_ACCESS_KEY ?? "" }), transport: http() });
for (const r of ["ATTESTER", "SUPPLIER", "INVESTOR"]) {
  const a = wallet(r).account.address;
  console.log(r.padEnd(9), a, formatEther(await c.getBalance({ address: a })), "tGLM");
}
console.log("ARKIV_ACCESS_KEY in .env:", env.ARKIV_ACCESS_KEY ? "yes" : "no");
