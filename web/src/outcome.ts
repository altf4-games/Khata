// How a finished action is reported: which explorer its transaction lives on, and the words shown. Kept free of any
// network code so it can be tested on its own.
export type ChainName = "whitechain" | "arkiv";

export const EXPLORERS: Record<ChainName, string> = {
  whitechain: "https://explorer.testnet.whitechain.io",
  arkiv: "https://rabdi.explorer.arkiv.network",
};

/** A transaction link on the explorer of the chain it was sent to (an Arkiv hash means nothing to Whitechain's explorer). */
export function txLink(hash: string, chain: ChainName = "whitechain"): string {
  return `${EXPLORERS[chain]}/tx/${hash}`;
}

/** What an action hands back: its transaction, and optionally words that replace the default detail (a partial success). */
export interface Outcome {
  hash: `0x${string}`;
  gasUsed: bigint;
  chain?: ChainName;
  detail?: string;
}

export interface DoneMsg { kind: "ok"; title: string; detail?: string; hash?: string; chain?: ChainName }

export function doneMsg(sent: Outcome | undefined, title: string, detail?: string): DoneMsg {
  const gas = sent && sent.gasUsed > 0n ? `Used ${sent.gasUsed.toLocaleString("en-IN")} gas.` : undefined;
  return { kind: "ok", title, detail: sent?.detail ?? detail ?? gas, hash: sent?.hash, chain: sent?.chain };
}
