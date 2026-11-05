import { createPublicClient, createWalletClient, custom, defineChain, http, type Address, type Hex } from "viem";
import registryAbi from "./registry-abi.json";
import deployment from "../../deployments/whitechain-sepolia.json";

export const whitechainSepolia = defineChain({
  id: 1874,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: deployment.explorer } },
});

export const registryAddress = deployment.KhataRegistry as Address;
export const explorerUrl = deployment.explorer;
export const abi = registryAbi as never;

// Reads currently go straight to the public RPC. Routing them through Anon-RPC is not built yet.
export const publicClient = createPublicClient({ chain: whitechainSepolia, transport: http() });

export interface Invoice {
  sellerGstin: string;
  buyerGstin: string;
  docNo: string;
  docDt: string;
  valuePaise: bigint;
  irn: Hex;
  hasIrnDt: boolean;
  irnDt: string;
}

export interface Inspection {
  kid: string;
  keyRegistered: boolean;
  keyActive: boolean;
  keyIsDemo: boolean;
  signatureValid: boolean;
  invoice: Invoice;
  nullifier: Hex;
  alreadyBound: boolean;
}

export async function inspect(token: string): Promise<Inspection> {
  return (await publicClient.readContract({ address: registryAddress, abi, functionName: "inspect", args: [token] })) as Inspection;
}

/** Finds the custom error name inside a viem error. */
export function revertInfo(err: unknown): { name?: string; args?: readonly unknown[]; message: string } {
  let e: any = err;
  while (e) {
    if (e.data?.errorName) return { name: e.data.errorName, args: e.data.args, message: e.shortMessage ?? e.message };
    e = e.cause;
  }
  const any = err as any;
  return { message: any?.shortMessage ?? any?.message ?? String(err) };
}

export const DUMMY_SENDER = "0x000000000000000000000000000000000000dEaD" as Address;

export async function simulateBind(token: string, account: Address) {
  return publicClient.simulateContract({ address: registryAddress, abi, functionName: "bindInvoice", args: [token], account });
}

export function eip1193(): any | undefined {
  return (window as any).ethereum;
}

export async function connectWallet() {
  const provider = eip1193();
  if (!provider) throw new Error("no-wallet");
  const walletClient = createWalletClient({ chain: whitechainSepolia, transport: custom(provider) });
  const [account] = await walletClient.requestAddresses();
  try {
    await walletClient.switchChain({ id: whitechainSepolia.id });
  } catch {
    await walletClient.addChain({ chain: whitechainSepolia });
    await walletClient.switchChain({ id: whitechainSepolia.id });
  }
  return { walletClient, account };
}

export function txUrl(hash: string) {
  return `${explorerUrl}/tx/${hash}`;
}
export function addressUrl(addr: string) {
  return `${explorerUrl}/address/${addr}`;
}
