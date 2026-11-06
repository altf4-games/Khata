// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {AttesterRegistry} from "../src/AttesterRegistry.sol";

/// The contract's EIP-712 digests must equal the ones viem computes from the app's own type definitions
/// (web/src/eip712.ts; web/tests/eip712-golden.spec.ts checks the same fixture). Every other forge test signs with the
/// contract's own digest functions, so without this a typehash or field-order mismatch with the app would pass offline.
contract Eip712GoldenTest is Test {
    function test_digestsMatchTheAppsTypedData() public {
        string memory g = vm.readFile("contracts/test/fixtures/eip712-golden.json");
        address at = vm.parseJsonAddress(g, ".verifyingContract");
        vm.chainId(1874);
        deployCodeTo("AttesterRegistry.sol:AttesterRegistry", abi.encode(address(this)), at);
        AttesterRegistry att = AttesterRegistry(at);
        bytes32 credId = bytes32(0xabababababababababababababababababababababababababababababababab);

        assertEq(
            att.eligibilityDigest(
                AttesterRegistry.Eligibility({
                    subject: 0x54E2221e61E436D7FF101640CF1edCC983dd75A5, tier: 2, jurisdiction: 356, validUntil: 1900000000, credId: credId
                })
            ),
            vm.parseJsonBytes32(g, ".eligibility")
        );
        assertEq(
            att.sellerBindingDigest(
                AttesterRegistry.SellerBinding({
                    gstinHash: bytes32(0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd),
                    wallet: 0xa03d3c24469DD58EAE3AE230781f293850A7686b,
                    validUntil: 1900000000,
                    version: 7
                })
            ),
            vm.parseJsonBytes32(g, ".sellerBinding")
        );
        assertEq(att.revocationDigest(AttesterRegistry.Revocation({credId: credId})), vm.parseJsonBytes32(g, ".revocation"));
    }
}
