// Labelled demo wallets. Their keys come from the ignored root .env at dev time (DEMO_*_KEY) and are never committed.
// With no keys present the app is read-only: it still verifies and shows notes, but cannot send transactions.
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { whitechainSepolia } from "./chain";

export type Role = "supplier" | "investor" | "debtor" | "attester";

export interface DemoWallet {
  id: string;
  label: string;
  role: Role;
  address: Address;
  account: PrivateKeyAccount;
  client: ReturnType<typeof createWalletClient>;
}

const env = import.meta.env as Record<string, string | undefined>;
const SPEC: { id: string; label: string; role: Role; key: string | undefined }[] = [
  { id: "supplier", label: "Supplier (demo)", role: "supplier", key: env.DEMO_SUPPLIER_KEY },
  { id: "investor", label: "Investor A (demo)", role: "investor", key: env.DEMO_INVESTOR_KEY },
  { id: "investor2", label: "Investor B (demo)", role: "investor", key: env.DEMO_INVESTOR2_KEY },
  { id: "debtor", label: "Debtor (demo)", role: "debtor", key: env.DEMO_DEBTOR_KEY },
  { id: "attester", label: "Attester (demo)", role: "attester", key: env.DEMO_ATTESTER_KEY },
];

export const wallets: DemoWallet[] = SPEC.filter((s) => s.key && /^0x[0-9a-fA-F]{64}$/.test(s.key)).map((s) => {
  const account = privateKeyToAccount(s.key as Hex);
  return {
    id: s.id, label: s.label, role: s.role, address: account.address, account,
    client: createWalletClient({ account, chain: whitechainSepolia, transport: http() }),
  };
});

export const walletsFor = (role: Role) => wallets.filter((w) => w.role === role);

/** Name for an address if it is one of the labelled demo wallets, otherwise undefined. */
export function nameOf(addr: string): string | undefined {
  return wallets.find((w) => w.address.toLowerCase() === addr.toLowerCase())?.label;
}
