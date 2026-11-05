// Copies the ABIs the web app needs from the Foundry build output. Run `forge build` first.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { abiOf, root } from "./lib/chain.mjs";

const files = {
  KhataRegistry: "registry-abi.json",
  KhataFactory: "factory-abi.json",
  KhataNote: "note-abi.json",
  AttesterRegistry: "attesters-abi.json",
};
for (const [contract, file] of Object.entries(files)) {
  const abi = abiOf(contract);
  writeFileSync(join(root, "web/src", file), JSON.stringify(abi, null, 1) + "\n");
  console.log(`${contract}: exported ${abi.length} ABI entries to web/src/${file}`);
}
