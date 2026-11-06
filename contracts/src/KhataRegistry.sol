// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {NicJwt} from "./NicJwt.sol";
import {NicInvoice} from "./NicInvoice.sol";
import {AttesterRegistry} from "./AttesterRegistry.sol";

/// @notice Checks a zero-knowledge proof (made with the Noir circuit in zk/khata_zk) that a registered key signed an e-invoice.
interface IProofVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// @notice Holds the accepted signing keys by `kid` and binds each e-invoice (by IRN) at most once.
/// @dev Only the wallet an accepted attester has bound to the invoice's seller GSTIN may bind that
///      seller's invoices, so holding a copy of the QR is not enough (QR squatting). The duplicate
///      block is local to this registry; it says nothing about other platforms or banks.
contract KhataRegistry is Ownable2Step {
    error KeyAlreadyRegistered(string kid);
    error UnknownKey(string kid);
    error KeyIsRetired(string kid);
    error InvalidKey();
    error ModulusAlreadyRegistered();
    error OwnershipCannotBeRenounced();
    error InvalidSignature();
    error IrnAlreadyFinanced(bytes32 nullifier);
    error InvalidWallet();
    error StaleBinding(uint64 currentVersion);
    error SellerNotRegistered(bytes32 gstinHash);
    error NotSellerWallet(address expected);
    error SellerBindingExpired(uint64 validUntil);
    error VersionTooFar(uint64 version);
    error ZkNotEnabled();
    error ZkKeyRetired();
    error BadProofInputs();
    error UnknownZkKey();
    error DemoFlagMismatch();
    error ProofNotForCaller(address expected);
    error InvalidProof();

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
        uint64 fundableAt; // boundAt + cool-off: an IRN can be cancelled within 24 h and the signature still verifies
        bytes32 sellerGstinHash;
    }

    struct Seller {
        address wallet;
        uint64 validUntil;
        uint64 version;
        address attester; // who signed the binding; if it is removed the binding stops counting
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
        address sellerWallet; // the wallet allowed to bind this seller's invoices, zero if none
    }

    event KeyAdded(bytes32 indexed kidHash, string kid, bool demo);
    event ZkVerifierSet(address indexed previous, address indexed verifier);
    event KeyRetired(bytes32 indexed kidHash, string kid);
    event InvoiceBound(
        bytes32 indexed nullifier, bytes32 indexed irn, bytes32 indexed kidHash, address binder, uint256 valuePaise
    );

    event SellerRegistered(bytes32 indexed gstinHash, address indexed wallet, address indexed attester, uint64 version);

    AttesterRegistry public immutable attesters;
    uint64 public immutable coolOff;

    mapping(bytes32 kidHash => Key) private _keys;
    /// keccak256(modulus bytes) to the key's kid hash, so a proof's public modulus finds its registered key
    mapping(bytes32 modulusHash => bytes32 kidHash) private _kidByModulus;
    IProofVerifier public zkVerifier;

    /// Public inputs of the circuit, in order: 18 modulus limbs, owner, demo flag, nullifier (hi, lo), GSTIN hash (hi, lo), paise.
    uint256 internal constant ZK_INPUTS = 25;
    uint256 internal constant LIMB_BITS = 120;
    mapping(bytes32 nullifier => Binding) public bindings;
    uint64 public constant MAX_VERSION_STEP = 1_000_000;
    mapping(bytes32 gstinHash => Seller) public sellers;

    constructor(address initialOwner, AttesterRegistry attesters_, uint64 coolOff_) Ownable(initialOwner) {
        attesters = attesters_;
        coolOff = coolOff_;
    }

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
        bytes32 mh = keccak256(modulus);
        if (_kidByModulus[mh] != bytes32(0)) revert ModulusAlreadyRegistered();
        _keys[h] = Key(modulus, exponent, true, true, demo);
        _kidByModulus[mh] = h;
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

    // ---------- seller wallets ----------

    /// @notice Records an attester-signed binding of a seller GSTIN to a wallet. Anyone may submit it.
    ///         Versions must increase, so an old binding cannot be replayed to take the GSTIN back.
    function registerSeller(AttesterRegistry.SellerBinding calldata b, bytes calldata signature) external {
        if (b.wallet == address(0)) revert InvalidWallet();
        address attester = attesters.verifySellerBinding(b, signature);
        Seller storage s = sellers[b.gstinHash];
        if (b.version <= s.version) revert StaleBinding(s.version);
        // Versions only move forward, so a huge jump would lock the GSTIN for good.
        if (b.version - s.version > MAX_VERSION_STEP) revert VersionTooFar(b.version);
        sellers[b.gstinHash] = Seller(b.wallet, b.validUntil, b.version, attester);
        emit SellerRegistered(b.gstinHash, b.wallet, attester, b.version);
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
        bytes32 gstinHash = keccak256(bytes(inv.sellerGstin));
        _requireSellerWallet(gstinHash);

        nullifier = k.demo ? NicInvoice.demoNullifierOf(inv.irn) : NicInvoice.nullifierOf(inv.irn);
        if (bindings[nullifier].boundAt != 0) revert IrnAlreadyFinanced(nullifier);

        bindings[nullifier] = Binding(
            msg.sender,
            uint64(block.timestamp),
            uint128(inv.valuePaise),
            inv.irn,
            uint64(block.timestamp) + coolOff,
            gstinHash
        );
        emit InvoiceBound(nullifier, inv.irn, keccak256(bytes(kid)), msg.sender, inv.valuePaise);
    }

    /// @dev The wallet an accepted attester bound to this seller GSTIN, still in date, must be the caller.
    function _requireSellerWallet(bytes32 gstinHash) private view {
        Seller memory seller = sellers[gstinHash];
        if (seller.wallet == address(0) || !attesters.isAttester(seller.attester)) {
            revert SellerNotRegistered(gstinHash);
        }
        if (msg.sender != seller.wallet) revert NotSellerWallet(seller.wallet);
        if (seller.validUntil <= block.timestamp) revert SellerBindingExpired(seller.validUntil);
    }

    // ---------- zero-knowledge binding ----------

    /// @notice Turns on binding by proof. Set once the verifier for the circuit's verification key is deployed.
    function setZkVerifier(address verifier) external onlyOwner {
        emit ZkVerifierSet(address(zkVerifier), verifier);
        zkVerifier = IProofVerifier(verifier);
    }

    /// @notice Binds an invoice from a proof instead of the token: the token never goes on chain, so the buyer and the other
    ///         invoice fields stay private; only the nullifier, the seller's GSTIN hash and the value are public. The IRN is not a
    ///         secret against a guesser: it is a hash of public-ish fields (seller GSTIN, year, type, number), so anyone can test
    ///         guessed invoice numbers against the public nullifier.
    ///         The proof names the caller as its owner, so nobody else can submit it. The IRN is stored as zero.
    function bindInvoiceZk(bytes calldata proof, bytes32[] calldata publicInputs) external returns (bytes32 nullifier) {
        if (address(zkVerifier) == address(0)) revert ZkNotEnabled();
        if (publicInputs.length != ZK_INPUTS) revert BadProofInputs();
        if (publicInputs[18] != bytes32(uint256(uint160(msg.sender)))) {
            revert ProofNotForCaller(address(uint160(uint256(publicInputs[18]))));
        }

        // the signing key: the 18 public limbs must rebuild exactly the modulus of a registered key
        bytes32 kidHash = _kidByModulus[_modulusHash(publicInputs)];
        if (kidHash == bytes32(0)) revert UnknownZkKey();
        Key storage k = _keys[kidHash];
        if (!k.active) revert ZkKeyRetired();
        if (publicInputs[19] != bytes32(uint256(k.demo ? 1 : 0))) revert DemoFlagMismatch();

        nullifier = bytes32((uint256(publicInputs[20]) << 128) | uint256(publicInputs[21]));
        bytes32 gstinHash = bytes32((uint256(publicInputs[22]) << 128) | uint256(publicInputs[23]));
        uint256 paise = uint256(publicInputs[24]);
        // both halves are 128-bit numbers by construction of the circuit; reject anything wider so the packing is unambiguous
        if (
            (uint256(publicInputs[20])
                            | uint256(publicInputs[21])
                            | uint256(publicInputs[22])
                            | uint256(publicInputs[23])) >> 128 != 0 || paise == 0 || paise > type(uint64).max
        ) {
            revert BadProofInputs();
        }

        _requireSellerWallet(gstinHash);
        if (bindings[nullifier].boundAt != 0) revert IrnAlreadyFinanced(nullifier);
        if (!zkVerifier.verify(proof, publicInputs)) revert InvalidProof();

        bindings[nullifier] = Binding(
            msg.sender,
            uint64(block.timestamp),
            uint128(paise),
            bytes32(0),
            uint64(block.timestamp) + coolOff,
            gstinHash
        );
        emit InvoiceBound(nullifier, bytes32(0), kidHash, msg.sender, paise);
    }

    /// @dev keccak256 of the 256 modulus bytes rebuilt from 18 limbs of 120 bits (least significant first). A limb of 2^120 or
    ///      more is not a valid limb and cannot be the registered modulus, so it hashes to nothing registered.
    function _modulusHash(bytes32[] calldata inputs) private pure returns (bytes32) {
        bytes memory n = new bytes(270); // 18 limbs of 15 bytes, big-endian overall
        for (uint256 i; i < 18; ++i) {
            uint256 limb = uint256(inputs[i]);
            if (limb >> LIMB_BITS != 0) return bytes32(0);
            for (uint256 j; j < 15; ++j) {
                n[269 - (i * 15 + j)] = bytes1(uint8(limb >> (8 * j)));
            }
        }
        // 2048 bits are 256 bytes, so the top 14 of the 270 bytes must be zero
        for (uint256 t; t < 14; ++t) {
            if (n[t] != 0) return bytes32(0);
        }
        bytes memory out = new bytes(256);
        for (uint256 u; u < 256; ++u) {
            out[u] = n[14 + u];
        }
        return keccak256(out);
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
        Seller memory sl = sellers[keccak256(bytes(r.invoice.sellerGstin))];
        r.sellerWallet = attesters.isAttester(sl.attester) ? sl.wallet : address(0);
    }
}
