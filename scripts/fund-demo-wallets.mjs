// Sends testnet WBT (gas) from the deployer to the labelled demo wallets in .env. Prints addresses and tx hashes only.
import { parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { clients, loadEnv } from "./lib/chain.mjs";

const plan = { ATTESTER: "0.008", SUPPLIER: "0.04", INVESTOR: "0.03", INVESTOR2: "0.012", DEBTOR: "0.015" };
const env = loadEnv();
const { publicClient, walletClient } = clients();

for (const [name, amount] of Object.entries(plan)) {
  const key = env[`DEMO_${name}_KEY`];
  if (!key) throw new Error(`DEMO_${name}_KEY missing in .env`);
  const address = privateKeyToAccount(key).address;
  const have = await publicClient.getBalance({ address });
  const want = parseEther(amount);
  if (have >= want) {
    console.log(`${name.padEnd(10)} ${address} already holds ${formatEther(have)} WBT`);
    continue;
  }
  const hash = await walletClient.sendTransaction({ to: address, value: want - have });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`${name.padEnd(10)} ${address} topped up to ${amount} WBT  tx ${hash}`);
}
