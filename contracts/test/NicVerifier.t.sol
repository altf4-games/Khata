// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {NicVerifier} from "../src/NicVerifier.sol";

contract NicVerifierTest is Test {
    NicVerifier internal verifier;

    function setUp() public {
        verifier = new NicVerifier();
    }

    /// NIC's published sample QR (a Rs 2 test invoice) carries a genuine RS256
    /// signature. Token and public key are fixtures taken from NIC's QR procedure PDF.
    function test_nicSampleTokenVerifies() public view {
        string memory token = vm.readFile("contracts/test/fixtures/nic-sample.token");
        bytes memory modulus = vm.parseBytes(vm.readFile("contracts/test/fixtures/nic-sample.modulus.hex"));
        bytes memory exponent = hex"010001";

        assertTrue(verifier.verify(token, modulus, exponent), "NIC sample must verify");
    }
}
