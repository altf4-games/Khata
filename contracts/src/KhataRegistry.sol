// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {NicJwt} from "./NicJwt.sol";
import {NicInvoice} from "./NicInvoice.sol";

/// @notice Holds the accepted signing keys by `kid` and binds each e-invoice (by IRN) at most once.
/// @dev NOT YET IMPLEMENTED here: restricting `bindInvoice` to the seller's wallet. Today anyone
///      holding a valid token can bind it first, so QR squatting is possible. The duplicate block is
///      local to this registry; it says nothing about other platforms or banks.
contract KhataRegistry is Ownable2Step {
    error KeyAlreadyRegistered(string kid);
    error UnknownKey(string kid);
    error KeyIsRetired(string kid);
    error InvalidKey();
    error OwnershipCannotBeRenounced();
    error InvalidSignature();
    error IrnAlreadyFinanced(bytes32 nullifier);

    uint32 internal constant MIN_EXPONENT = 65537;
    uint256 internal constant MAX_KID_BYTES = 64;

    struct Key {
        bytes modulus;
        bytes exponent;
        bool exists;
        bool active;
        bool demo; // a labelled demo key: its invoices use a separate nullifier namespace
    }

    struct Binding {
        address binder;
        uint64 boundAt;
        uint128 valuePaise;
        bytes32 irn;
    }

    /// What the verification panel shows for a scanned token, without changing any state.
    struct Inspection {
        string kid;
        bool keyRegistered;
        bool keyActive;
        bool keyIsDemo;
        bool signatureValid;
        NicInvoice.Invoice invoice;
        bytes32 nullifier;
        bool alreadyBound;
    }

    event KeyAdded(bytes32 indexed kidHash, string kid, bool demo);
    event KeyRetired(bytes32 indexed kidHash, string kid);
    event InvoiceBound(
        bytes32 indexed nullifier, bytes32 indexed irn, bytes32 indexed kidHash, address binder, uint256 valuePaise
    );

    mapping(bytes32 kidHash => Key) private _keys;
    mapping(bytes32 nullifier => Binding) public bindings;

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @dev Renouncing would make a compromised key impossible to retire.
    function renounceOwnership() public view override onlyOwner {
        revert OwnershipCannotBeRenounced();
    }

    // ---------- key registry (owner updates it when NIC rotates keys) ----------

    /// @param demo True for a labelled demo key. Its invoices bind in a separate namespace from government keys.
    function addKey(string calldata kid, bytes calldata modulus, bytes calldata exponent, bool demo)
        external
        onlyOwner
    {
        uint256 kl = bytes(kid).length;
        if (kl == 0 || kl > MAX_KID_BYTES) revert InvalidKey();
        _requireUsableKey(modulus, exponent);

        bytes32 h = keccak256(bytes(kid));
        if (_keys[h].exists) revert KeyAlreadyRegistered(kid);
        _keys[h] = Key(modulus, exponent, true, true, demo);
        emit KeyAdded(h, kid, demo);
    }

    /// @dev RSA-2048, 3072 or 4096: no leading zero byte (the signature check needs the exact length), odd modulus,
    ///      and an odd exponent of at least 65537 with no leading zero byte (small exponents such as 1 allow forgery).
    function _requireUsableKey(bytes calldata modulus, bytes calldata exponent) private pure {
        uint256 ml = modulus.length;
        if (ml != 256 && ml != 384 && ml != 512) revert InvalidKey();
        if (modulus[0] == 0 || uint8(modulus[ml - 1]) & 1 == 0) revert InvalidKey();

        uint256 el = exponent.length;
        if (el == 0 || el > 4 || exponent[0] == 0) revert InvalidKey();
        uint256 e;
        for (uint256 i; i < el; ++i) {
            e = (e << 8) | uint8(exponent[i]);
        }
        if (e < MIN_EXPONENT || e & 1 == 0) revert InvalidKey();
    }

    /// @notice Stops a key from binding new invoices. Bindings already made stay.
    function retireKey(string calldata kid) external onlyOwner {
        bytes32 h = keccak256(bytes(kid));
        if (!_keys[h].exists) revert UnknownKey(kid);
        _keys[h].active = false;
        emit KeyRetired(h, kid);
    }

    function keyOf(string calldata kid)
        external
        view
        returns (bytes memory modulus, bytes memory exponent, bool active, bool demo)
    {
        Key storage k = _keys[keccak256(bytes(kid))];
        if (!k.exists) revert UnknownKey(kid);
        return (k.modulus, k.exponent, k.active, k.demo);
    }

    // ---------- binding ----------

    /// @notice Verifies the NIC signature on `token`, parses it and binds its IRN. Reverts if the IRN was bound before.
    function bindInvoice(string calldata token) external returns (bytes32 nullifier) {
        NicJwt.Parts memory p = NicJwt.split(token);
        string memory kid = NicJwt.kidOf(p);
        Key storage k = _keys[keccak256(bytes(kid))];
        if (!k.exists) revert UnknownKey(kid);
        if (!k.active) revert KeyIsRetired(kid);
        if (!NicJwt.verifySignature(p, k.exponent, k.modulus)) revert InvalidSignature();

        NicInvoice.Invoice memory inv = NicInvoice.parse(p.payload);
        nullifier = k.demo ? NicInvoice.demoNullifierOf(inv.irn) : NicInvoice.nullifierOf(inv.irn);
        if (bindings[nullifier].boundAt != 0) revert IrnAlreadyFinanced(nullifier);

        bindings[nullifier] = Binding(msg.sender, uint64(block.timestamp), uint128(inv.valuePaise), inv.irn);
        emit InvoiceBound(nullifier, inv.irn, keccak256(bytes(kid)), msg.sender, inv.valuePaise);
    }

    function isBound(bytes32 nullifier) external view returns (bool) {
        return bindings[nullifier].boundAt != 0;
    }

    /// @notice Read-only check of a token for the verification panel. Reverts only if the token structure or header
    ///         cannot be read, or a validly signed payload is not an acceptable invoice.
    function inspect(string calldata token) external view returns (Inspection memory r) {
        NicJwt.Parts memory p = NicJwt.split(token);
        r.kid = NicJwt.kidOf(p);
        Key storage k = _keys[keccak256(bytes(r.kid))];
        r.keyRegistered = k.exists;
        r.keyActive = k.exists && k.active;
        r.keyIsDemo = k.exists && k.demo;
        r.signatureValid = k.exists && NicJwt.verifySignature(p, k.exponent, k.modulus);
        // Invoice data is read only after the signature has verified, so unverified bytes are never shown as facts.
        if (!r.signatureValid) return r;
        r.invoice = NicInvoice.parse(p.payload);
        r.nullifier = k.demo ? NicInvoice.demoNullifierOf(r.invoice.irn) : NicInvoice.nullifierOf(r.invoice.irn);
        r.alreadyBound = bindings[r.nullifier].boundAt != 0;
    }
}
