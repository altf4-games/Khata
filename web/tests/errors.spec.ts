// Every custom error the contracts can raise reads as a plain sentence, never the generic "request was refused".
import { expect, test } from "@playwright/test";
import { refusalFor } from "../src/errors";
import registry from "../src/registry-abi.json" with { type: "json" };
import factory from "../src/factory-abi.json" with { type: "json" };
import note from "../src/note-abi.json" with { type: "json" };
import attesters from "../src/attesters-abi.json" with { type: "json" };

// raised only by the owner's own admin calls or by libraries the app never reaches; the app never sends these
const ADMIN_ONLY = new Set([
  "OwnableUnauthorizedAccount", "OwnableInvalidOwner", "OwnershipCannotBeRenounced", "InvalidShortString", "StringTooLong",
  "SafeERC20FailedOperation", "ReentrancyGuardReentrantCall", "ECDSAInvalidSignature", "ECDSAInvalidSignatureLength", "ECDSAInvalidSignatureS",
  "ERC20InvalidApprover", "ERC20InvalidSpender", "ERC20InsufficientAllowance", "ERC20InvalidSender", "ERC20InvalidReceiver",
  "KeyAlreadyRegistered", "ModulusAlreadyRegistered", "InvalidKey", "InvalidAttester", "KeyIsRetired", "UnknownKey", "MathOverflowedMulDiv",
]);

const names = [...new Set([registry, factory, note, attesters].flat().filter((i: any) => i.type === "error").map((i: any) => i.name as string))];

test("each error the app can meet has its own plain-language message", () => {
  const generic = names.filter((n) => !ADMIN_ONLY.has(n) && refusalFor(n, ["1", "2", "3"]).title === "The request was refused");
  expect(generic, `errors that fall through to the generic message: ${generic.join(", ")}`).toEqual([]);
});

test("ExceedsAvailable shows the exact amount left, not a float rounded to cents", () => {
  expect(refusalFor("ExceedsAvailable", [999_999n]).title + refusalFor("ExceedsAvailable", [999_999n]).detail).toContain("0.999999");
  expect(JSON.stringify(refusalFor("ExceedsAvailable", [4_000n]))).toContain("0.004");
});
