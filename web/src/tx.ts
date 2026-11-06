// Sends a transaction from a demo wallet: simulate first (so a revert becomes a readable refusal), then send and wait.
import type { Abi, Address } from "viem";
import { publicClient, revertInfo } from "./chain";

const LOW_WBT = 10_000_000_000_000_000n; // 0.01 WBT
import type { DemoWallet } from "./wallets";

export type { Outcome as Sent } from "./outcome";
import type { Outcome as Sent } from "./outcome";
import { oneAtATime } from "./queue";

/** Sends from a demo wallet, one transaction at a time per wallet so two clicks never race for the same nonce. */
export function send(w: DemoWallet, address: Address, abi: Abi, functionName: string, args: unknown[], gas?: bigint): Promise<Sent> {
  return oneAtATime(w.address, () => sendNow(w, address, abi, functionName, args, gas));
}

async function sendNow(w: DemoWallet, address: Address, abi: Abi, functionName: string, args: unknown[], gas?: bigint): Promise<Sent> {
  let sim;
  try {
    sim = await publicClient.simulateContract({ address, abi, functionName, args, account: w.address, gas });
  } catch (e) {
    // A wallet too poor to cover the gas limit makes the node refuse the call with no reason; say what is really wrong.
    if (!revertInfo(e).name && (await publicClient.getBalance({ address: w.address })) < LOW_WBT) throw new Error("insufficient funds for gas");
    throw e;
  }
  const hash = await w.client.writeContract({ ...(sim.request as any), account: w.client.account!, chain: w.client.chain });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The transaction was mined but reverted.");
  return { hash, gasUsed: receipt.gasUsed };
}
