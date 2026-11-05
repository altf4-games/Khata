// Prints WBT and USDT balances of the deployer and the labelled demo wallets. Addresses and numbers only.
import { formatEther, formatUnits, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { clients, loadEnv } from "./lib/chain.mjs";

const usdt = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const { publicClient, account } = clients();
const env = loadEnv();
const rows = [["DEPLOYER", account.address]];
for (const r of ["ATTESTER", "SUPPLIER", "INVESTOR", "INVESTOR2", "DEBTOR"]) rows.push([r, privateKeyToAccount(env[`DEMO_${r}_KEY`]).address]);
let w = 0n, t = 0n;
for (const [name, address] of rows) {
  const wbt = await publicClient.getBalance({ address });
  const tt = await publicClient.readContract({ address: usdt, abi, functionName: "balanceOf", args: [address] });
  w += wbt; t += tt;
  console.log(`${name.padEnd(10)} ${address}  ${formatEther(wbt).padStart(10)} WBT  ${formatUnits(tt, 6).padStart(9)} USDT`);
}
console.log(`${"TOTAL".padEnd(10)} ${" ".repeat(42)}  ${formatEther(w).padStart(10)} WBT  ${formatUnits(t, 6).padStart(9)} USDT`);
