// Labelled demo wallets. The browser knows only their public addresses (deployments/demo-wallets.json). Every signature is made by
// the server signer at /api/sign, which holds the keys in server-side environment variables, so no key is ever in the page.
import { createWalletClient, type Address, type Hex, type LocalAccount } from "viem";
import { toAccount } from "viem/accounts";
import { whitechainSepolia } from "./chain";
import { chainTransport } from "./anon";
import demoWallets from "../../deployments/demo-wallets.json";
import { wire } from "../../api/_wire.ts";

export type Role = "supplier" | "investor" | "debtor" | "attester";

export interface DemoWallet {
  id: string;
  label: string;
  role: Role;
  address: Address;
  account: LocalAccount;
  client: ReturnType<typeof createWalletClient>;
}

/** Asks the server signer. A refusal or an unconfigured wallet comes back as a plain error, never a silent success. */
async function remoteSign(wallet: string, body: Record<string, unknown>): Promise<Hex> {
  let res: Response;
  try {
    // Signing is not a chain read, so it goes straight to this site's own server and never through Anon-RPC.
    res = await fetch("/api/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(wire.encode({ wallet, ...body })) });
  } catch {
    throw new Error("The demo signer could not be reached.");
  }
  const json = (await res.json().catch(() => ({}))) as { signed?: Hex; error?: string };
  if (!res.ok || !json.signed) throw new Error(json.error ?? `The demo signer refused (HTTP ${res.status}).`);
  return json.signed;
}

function remoteAccount(id: string, address: Address): LocalAccount {
  return toAccount({
    address,
    signTransaction: (tx) => remoteSign(id, { kind: "transaction", tx }),
    signTypedData: ((td: unknown) => remoteSign(id, { kind: "typedData", typedData: td })) as never,
    signMessage: async () => {
      throw new Error("Demo wallets sign transactions and the app's typed data only, never free-form messages.");
    },
  });
}

export const wallets: DemoWallet[] = (demoWallets as { id: string; label: string; role: Role; address: Address }[]).map((s) => {
  const account = remoteAccount(s.id, s.address);
  return {
    ...s, account,
    client: createWalletClient({ account, chain: whitechainSepolia, transport: chainTransport() }),
  };
});

export const walletsFor = (role: Role) => wallets.filter((w) => w.role === role);

/** Name for an address if it is one of the labelled demo wallets, otherwise undefined. */
export function nameOf(addr: string): string | undefined {
  return wallets.find((w) => w.address.toLowerCase() === addr.toLowerCase())?.label;
}
