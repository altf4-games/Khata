// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Bytes} from "@openzeppelin/contracts/utils/Bytes.sol";
import {RSA} from "@openzeppelin/contracts/utils/cryptography/RSA.sol";
import {JsonLite} from "./JsonLite.sol";

/// @notice Splitting and RS256 verification of the JWT carried in a NIC e-invoice QR.
library NicJwt {
    error TokenTooLarge();
    error MalformedToken();
    error UnsupportedAlgorithm();
    error MissingKid();

    /// Real NIC tokens are about 1 KB. Anything larger is rejected before any work is done.
    uint256 internal constant MAX_TOKEN_BYTES = 2048;

    struct Parts {
        bytes signingInput; // base64url(header) "." base64url(payload), exactly the signed bytes
        bytes header; // decoded header JSON
        bytes payload; // decoded payload JSON
        bytes signature; // decoded signature
    }

    function split(string memory token) internal pure returns (Parts memory p) {
        bytes memory b = bytes(token);
        if (b.length == 0 || b.length > MAX_TOKEN_BYTES) {
            if (b.length == 0) revert MalformedToken();
            revert TokenTooLarge();
        }

        uint256 d1 = Bytes.indexOf(b, ".");
        if (d1 == type(uint256).max) revert MalformedToken();
        uint256 d2 = Bytes.indexOf(b, ".", d1 + 1);
        if (d2 == type(uint256).max) revert MalformedToken();
        if (Bytes.indexOf(b, ".", d2 + 1) != type(uint256).max) revert MalformedToken();
        if (d1 == 0 || d2 == d1 + 1 || d2 + 1 == b.length) revert MalformedToken();

        _requireCanonical(b, 0, d1);
        _requireCanonical(b, d1 + 1, d2);
        _requireCanonical(b, d2 + 1, b.length);

        p.signingInput = Bytes.slice(b, 0, d2);
        p.header = Base64.decode(string(Bytes.slice(b, 0, d1)));
        p.payload = Base64.decode(string(Bytes.slice(b, d1 + 1, d2)));
        p.signature = Base64.decode(string(Bytes.slice(b, d2 + 1)));
    }

    /// @dev Accepts only canonical unpadded base64url, so one signature has exactly one token text:
    ///      URL alphabet only, no padding, a length that is not 1 mod 4, and zero unused trailing bits.
    function _requireCanonical(bytes memory b, uint256 start, uint256 end) private pure {
        uint256 len = end - start;
        uint256 rem = len % 4;
        if (rem == 1) revert MalformedToken();
        uint256 last;
        for (uint256 i = start; i < end; ++i) {
            uint8 c = uint8(b[i]);
            if (c >= 65 && c <= 90) last = c - 65;
            else if (c >= 97 && c <= 122) last = c - 71;
            else if (c >= 48 && c <= 57) last = c + 4;
            else if (c == 45) last = 62;
            else if (c == 95) last = 63;
            else revert MalformedToken();
        }
        if (rem == 2 && last & 0x0f != 0) revert MalformedToken();
        if (rem == 3 && last & 0x03 != 0) revert MalformedToken();
    }

    /// @dev Requires `alg` to be RS256 and returns the `kid` header value.
    function kidOf(Parts memory p) internal pure returns (string memory) {
        JsonLite.Entry[] memory h = JsonLite.parseObject(p.header);
        (bool hasAlg, JsonLite.Entry memory alg) = JsonLite.find(h, "alg");
        if (!hasAlg || !alg.isString || !Bytes.equal(alg.value, "RS256")) revert UnsupportedAlgorithm();
        (bool hasKid, JsonLite.Entry memory kid) = JsonLite.find(h, "kid");
        if (!hasKid || !kid.isString || kid.value.length == 0) revert MissingKid();
        return string(kid.value);
    }

    /// @dev PKCS#1 v1.5 SHA-256 verification of the signing input with the given public key.
    function verifySignature(Parts memory p, bytes memory exponent, bytes memory modulus) internal view returns (bool) {
        return RSA.pkcs1Sha256(p.signingInput, p.signature, exponent, modulus);
    }
}
