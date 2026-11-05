import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const whitechainSepolia = defineChain({
  id: 1874,
  name: "Whitechain Sepolia",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  blockExplorers: { default: { name: "Whitechain Explorer", url: "https://explorer.testnet.whitechain.io" } },
});

/** Reads .env without printing anything. */
export function loadEnv() {
  const p = join(root, ".env");
  const out = {};
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function deployment() {
  return JSON.parse(readFileSync(join(root, "deployments/whitechain-sepolia.json"), "utf8"));
}

export function registryAbi() {
  const p = join(root, "out/KhataRegistry.sol/KhataRegistry.json");
  return JSON.parse(readFileSync(p, "utf8")).abi;
}

export function clients() {
  const env = loadEnv();
  const transport = http(env.WHITECHAIN_RPC_URL || whitechainSepolia.rpcUrls.default.http[0]);
  const publicClient = createPublicClient({ chain: whitechainSepolia, transport });
  const account = env.DEPLOYER_PRIVATE_KEY ? privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY) : undefined;
  const walletClient = account ? createWalletClient({ account, chain: whitechainSepolia, transport }) : undefined;
  return { publicClient, walletClient, account };
}

/** Finds the custom error name inside a viem error, or undefined. */
export function revertName(err) {
  let e = err;
  while (e) {
    if (e.data?.errorName) return { name: e.data.errorName, args: e.data.args };
    e = e.cause;
  }
  return undefined;
}
