// Sends a transaction from a demo wallet: simulate first (so a revert becomes a readable refusal), then send and wait.
import type { Abi, Address } from "viem";
import { publicClient } from "./chain";
import type { DemoWallet } from "./wallets";

export interface Sent {
  hash: `0x${string}`;
  gasUsed: bigint;
}

export async function send(w: DemoWallet, address: Address, abi: Abi, functionName: string, args: unknown[], gas?: bigint): Promise<Sent> {
  const sim = await publicClient.simulateContract({ address, abi, functionName, args, account: w.address, gas });
  const hash = await w.client.writeContract({ ...(sim.request as any), account: w.client.account!, chain: w.client.chain });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The transaction was mined but reverted.");
  return { hash, gasUsed: receipt.gasUsed };
}
