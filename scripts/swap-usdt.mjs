// Swaps WBT for the prize USDT through the Uniswap V3 pool on Whitechain Sepolia (WWBT/USDT, fee 3000).
// Usage: node scripts/swap-usdt.mjs <amountWBT> [--send]
// Without --send it only simulates and prints the expected output.
import { encodeAbiParameters, encodePacked, parseAbi, parseEther, formatUnits } from "viem";
import { clients } from "./lib/chain.mjs";

const ROUTER = "0xbCB198083504E31293bC3765b3c791cF2B2202d8";
const WWBT = "0x4200000000000000000000000000000000000006";
export const USDT = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
const MSG_SENDER = "0x0000000000000000000000000000000000000001";

const routerAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const amountArg = process.argv[2];
if (!amountArg) throw new Error("usage: node scripts/swap-usdt.mjs <amountWBT> [--send]");
const amount = parseEther(amountArg);
const send = process.argv.includes("--send");

const { publicClient, walletClient, account } = clients();
const path = encodePacked(["address", "uint24", "address"], [WWBT, 3000, USDT]);
const wrap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ADDRESS_THIS, amount]);
// V3_SWAP_EXACT_IN: recipient, amountIn, amountOutMin, path, payerIsUser, trailing uint256[] (this router's six-argument form)
const swap = encodeAbiParameters(
  [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }, { type: "uint256[]" }],
  [MSG_SENDER, amount, 0n, path, false, []],
);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
const args = { address: ROUTER, abi: routerAbi, functionName: "execute", args: ["0x0b00", [wrap, swap], deadline], value: amount, account };

const before = await publicClient.readContract({ address: USDT, abi: erc20, functionName: "balanceOf", args: [account.address] });
await publicClient.simulateContract(args);
console.log(`simulation ok for ${amountArg} WBT`);
if (!send) process.exit(0);

const hash = await walletClient.writeContract(args);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const after = await publicClient.readContract({ address: USDT, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`status ${receipt.status}  tx ${hash}`);
console.log(`USDT before ${formatUnits(before, 6)}  after ${formatUnits(after, 6)}  received ${formatUnits(after - before, 6)}`);
