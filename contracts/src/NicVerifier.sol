// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {NicJwt} from "./NicJwt.sol";
import {NicInvoice} from "./NicInvoice.sol";

/// @notice Stateless entry point to check a NIC e-invoice QR token against a given RSA public key.
contract NicVerifier {
    /// @param token The full JWT text exactly as scanned from the QR code.
    /// @param modulus RSA-2048 modulus of the signing key (big-endian bytes).
    /// @param exponent RSA public exponent (big-endian bytes).
    /// @return True only if the token is RS256 and its signature verifies under the key.
    function verify(string calldata token, bytes calldata modulus, bytes calldata exponent)
        external
        view
        returns (bool)
    {
        NicJwt.Parts memory p = NicJwt.split(token);
        NicJwt.kidOf(p);
        return NicJwt.verifySignature(p, exponent, modulus);
    }

    /// @notice The `kid` the token claims to be signed with.
    function kidOf(string calldata token) external pure returns (string memory) {
        return NicJwt.kidOf(NicJwt.split(token));
    }

    /// @notice Parses the invoice fields from a token. Does not check the signature.
    function parseInvoice(string calldata token) external pure returns (NicInvoice.Invoice memory) {
        return NicInvoice.parse(NicJwt.split(token).payload);
    }

    function nullifierOf(bytes32 irn) external pure returns (bytes32) {
        return NicInvoice.nullifierOf(irn);
    }
}
