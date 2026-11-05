// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Verifies the RS256 signature on a NIC e-invoice QR token.
/// @dev Not implemented yet: Stage 1 builds this behind the failing test in NicVerifier.t.sol.
contract NicVerifier {
    error NotImplemented();

    /// @param token The full JWT text exactly as scanned from the QR code.
    /// @param modulus RSA-2048 modulus of the signing key (big-endian bytes).
    /// @param exponent RSA public exponent (big-endian bytes).
    function verify(string calldata token, bytes calldata modulus, bytes calldata exponent)
        external
        pure
        returns (bool)
    {
        token;
        modulus;
        exponent;
        revert NotImplemented();
    }
}
