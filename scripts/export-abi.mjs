// Copies the registry ABI from the Foundry build output into the web app.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./lib/chain.mjs";

const abi = JSON.parse(readFileSync(join(root, "out/KhataRegistry.sol/KhataRegistry.json"), "utf8")).abi;
writeFileSync(join(root, "web/src/registry-abi.json"), JSON.stringify(abi, null, 1) + "\n");
console.log(`exported ${abi.length} ABI entries`);
