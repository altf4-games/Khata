import { createPublicClient, defineChain, http, parseAbi, type Address, type Hex } from "viem";
import registryAbi from "./registry-abi.json";
import factoryAbiJson from "./factory-abi.json";
import noteAbiJson from "./note-abi.json";
import attestersAbiJson from "./attesters-abi.json";
import deployment from "../../deployments/whitechain-sepolia.json";

export const whitechainSepolia = defineChain({
  id: 1874,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: deployment.explorer } },
});

const stage = deployment.stage2;
export const registryAddress = stage.KhataRegistry as Address;
export const factoryAddress = stage.KhataFactory as Address;
export const attestersAddress = stage.AttesterRegistry as Address;
export const usdtAddress = stage.usdt as Address;
export const factoryDeployTx = stage.deployTxs.KhataFactory as Hex;
export const explorerUrl = deployment.explorer;
export const abi = registryAbi as never;
export const factoryAbi = factoryAbiJson as never;
export const noteAbi = noteAbiJson as never;
export const attestersAbi = attestersAbiJson as never;
export const usdtAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function nonces(address) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);
// USDT permit domain on Whitechain, recovered by hashing candidates against DOMAIN_SEPARATOR (see logs/whitechain.md).
export const usdtPermitDomain = { name: "Tether USD", version: "1", chainId: 1874, verifyingContract: usdtAddress } as const;
// The attesters' EIP-712 domain.
export const attesterDomain = { name: "KhataAttesters", version: "1", chainId: 1874, verifyingContract: attestersAddress } as const;

// Reads currently go straight to the public RPC. Routing them through Anon-RPC is not built yet.
export const publicClient = createPublicClient({ chain: whitechainSepolia, transport: http(undefined, { batch: true }) });

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

export function txUrl(hash: string) {
  return `${explorerUrl}/tx/${hash}`;
}
export function addressUrl(addr: string) {
  return `${explorerUrl}/address/${addr}`;
}
