// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {NicVerifier} from "../src/NicVerifier.sol";
import {NicJwt} from "../src/NicJwt.sol";

contract NicVerifierTest is Test {
    NicVerifier internal verifier;

    string internal token;
    bytes internal modulus;
    bytes internal constant EXPONENT = hex"010001";

    function setUp() public {
        verifier = new NicVerifier();
        token = vm.readFile("contracts/test/fixtures/nic-sample.token");
        modulus = vm.parseBytes(vm.readFile("contracts/test/fixtures/nic-sample.modulus.hex"));
    }

    /// NIC's published sample QR (a Rs 2 test invoice) carries a genuine RS256
    /// signature. Token and public key are fixtures taken from NIC's QR procedure PDF.
    function test_nicSampleTokenVerifies() public view {
        assertTrue(verifier.verify(token, modulus, EXPONENT), "NIC sample must verify");
    }

    function test_headerKidIsNicKey() public view {
        assertEq(verifier.kidOf(token), "4DE1544AE695BDC84EC7BC12F2F57F813F44E301");
    }

    /// Change one character inside the payload part: the signature must no longer verify.
    function test_changedPayloadByteFails() public view {
        bytes memory t = bytes(token);
        uint256 firstDot = _indexOf(t, ".");
        uint256 pos = firstDot + 40;
        t[pos] = t[pos] == "A" ? bytes1("B") : bytes1("A");
        assertFalse(verifier.verify(string(t), modulus, EXPONENT), "tampered payload must fail");
    }

    function test_changedHeaderByteFails() public view {
        bytes memory t = bytes(token);
        t[5] = t[5] == "A" ? bytes1("B") : bytes1("A");
        // A changed header either no longer decodes to RS256 JSON (revert) or fails the check.
        try verifier.verify(string(t), modulus, EXPONENT) returns (bool ok) {
            assertFalse(ok);
        } catch {}
    }

    function test_changedSignatureByteFails() public view {
        bytes memory t = bytes(token);
        t[t.length - 10] = t[t.length - 10] == "A" ? bytes1("B") : bytes1("A");
        assertFalse(verifier.verify(string(t), modulus, EXPONENT), "tampered signature must fail");
    }

    function test_differentKeyFails() public view {
        bytes memory other = modulus;
        other[other.length - 1] = bytes1(uint8(other[other.length - 1]) ^ 0x02);
        assertFalse(verifier.verify(token, other, EXPONENT), "a different key must fail");
    }

    function test_wrongExponentFails() public view {
        assertFalse(verifier.verify(token, modulus, hex"03"), "a different exponent must fail");
    }

    function test_revertsWithoutThreeParts() public {
        vm.expectRevert(NicJwt.MalformedToken.selector);
        verifier.verify("abc.def", modulus, EXPONENT);
        vm.expectRevert(NicJwt.MalformedToken.selector);
        verifier.verify("a.b.c.d", modulus, EXPONENT);
        vm.expectRevert(NicJwt.MalformedToken.selector);
        verifier.verify("", modulus, EXPONENT);
    }

    function test_revertsOnOversizedToken() public {
        bytes memory big = new bytes(2049);
        for (uint256 i; i < big.length; ++i) {
            big[i] = "a";
        }
        vm.expectRevert(NicJwt.TokenTooLarge.selector);
        verifier.verify(string(big), modulus, EXPONENT);
    }

    function test_revertsOnNonRs256Header() public {
        // header {"alg":"HS256","kid":"X"}
        string memory t = "eyJhbGciOiJIUzI1NiIsImtpZCI6IlgifQ.e30.AAAA";
        vm.expectRevert(NicJwt.UnsupportedAlgorithm.selector);
        verifier.verify(t, modulus, EXPONENT);
    }

    function _indexOf(bytes memory b, bytes1 c) internal pure returns (uint256) {
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == c) return i;
        }
        revert("not found");
    }

    // ---------- red team: one token text per signature ----------

    function _sigStart(bytes memory t) internal pure returns (uint256) {
        for (uint256 i = t.length; i > 0; --i) {
            if (t[i - 1] == ".") return i;
        }
        revert("nodot");
    }

    function _withSig(string memory newSig) internal view returns (string memory) {
        bytes memory t = bytes(token);
        uint256 s = _sigStart(t);
        bytes memory head = new bytes(s);
        for (uint256 i; i < s; ++i) {
            head[i] = t[i];
        }
        return string.concat(string(head), newSig);
    }

    function _sig() internal view returns (bytes memory) {
        bytes memory t = bytes(token);
        uint256 s = _sigStart(t);
        bytes memory o = new bytes(t.length - s);
        for (uint256 i; i < o.length; ++i) {
            o[i] = t[s + i];
        }
        return o;
    }

    function test_rejectsPaddedSignature() public {
        string memory t = _withSig(string.concat(string(_sig()), "=="));
        vm.expectRevert(NicJwt.MalformedToken.selector);
        verifier.verify(t, modulus, EXPONENT);
    }

    function test_rejectsNonZeroTrailingBits() public {
        bytes memory sig = _sig();
        bytes memory al = bytes("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");
        uint256 idx;
        for (uint256 i; i < 64; ++i) {
            if (al[i] == sig[sig.length - 1]) idx = i;
        }
        sig[sig.length - 1] = al[idx ^ 1]; // flips an unused bit
        vm.expectRevert(NicJwt.MalformedToken.selector);
        verifier.verify(_withSig(string(sig)), modulus, EXPONENT);
    }

    function test_rejectsStandardAlphabetCharacters() public {
        bytes memory sig = _sig();
        bool changed;
        for (uint256 i; i < sig.length; ++i) {
            if (sig[i] == "-") {
                sig[i] = "+";
                changed = true;
                break;
            }
            if (sig[i] == "_") {
                sig[i] = "/";
                changed = true;
                break;
            }
        }
        assertTrue(changed, "fixture must contain - or _");
        vm.expectRevert(NicJwt.MalformedToken.selector);
        verifier.verify(_withSig(string(sig)), modulus, EXPONENT);
    }

    function test_rejectsBase64LengthOfOneModuloFour() public {
        vm.expectRevert(NicJwt.MalformedToken.selector);
        verifier.verify("eyJhbGciOiJSUzI1NiIsImtpZCI6IlgifQ.e30.AAAAA", modulus, EXPONENT);
    }
}
