// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @notice Which attester keys Khata trusts, the investor credentials and seller bindings they sign (EIP-712),
///         and revocations. Whitechain contracts cannot read Arkiv: Arkiv distributes the signed credential,
///         this contract verifies the signature, the expiry and any revocation.
/// @dev Attesters are trusted signers. Only plain ECDSA signers are supported (no ERC-1271 wallets).
///      A revocation is a message signed by the attester that issued the credential; anyone may submit it,
///      because deleting the Arkiv entity alone does not reach the chain.
contract AttesterRegistry is Ownable2Step, EIP712 {
    error InvalidAttester();
    error InvalidSignature();
    error UnknownAttester(address signer);
    error CredentialExpired(uint64 validUntil);
    error CredentialIsRevoked(bytes32 credId);
    error CredentialSuperseded(bytes32 credId);
    error ReplacementNeedsSubjectOrAttester();
    error OwnershipCannotBeRenounced();

    enum Reason {
        Eligible,
        NoCredential,
        Expired,
        Revoked,
        AttesterRemoved
    }

    struct Eligibility {
        address subject;
        uint8 tier;
        uint16 jurisdiction; // ISO 3166-1 numeric, 356 = India
        uint64 validUntil;
        bytes32 credId;
    }

    struct SellerBinding {
        bytes32 gstinHash; // keccak256 of the seller GSTIN text
        address wallet;
        uint64 validUntil;
        uint64 version; // strictly increasing per gstinHash, so an old binding cannot be replayed
    }

    struct Revocation {
        bytes32 credId;
    }

    struct Credential {
        address attester;
        uint8 tier;
        uint16 jurisdiction;
        uint64 validUntil;
        bytes32 credId;
    }

    bytes32 public constant ELIGIBILITY_TYPEHASH =
        keccak256("Eligibility(address subject,uint8 tier,uint16 jurisdiction,uint64 validUntil,bytes32 credId)");
    bytes32 public constant SELLER_BINDING_TYPEHASH =
        keccak256("SellerBinding(bytes32 gstinHash,address wallet,uint64 validUntil,uint64 version)");
    bytes32 public constant REVOCATION_TYPEHASH = keccak256("Revocation(bytes32 credId)");

    event AttesterAdded(address indexed attester);
    event AttesterRemoved(address indexed attester);
    event CredentialRegistered(
        address indexed subject, address indexed attester, bytes32 indexed credId, uint64 validUntil
    );
    event CredentialRevoked(address indexed attester, bytes32 indexed credId);

    mapping(address => bool) public isAttester;
    mapping(address attester => mapping(bytes32 credId => bool)) public isRevoked;
    /// A credential that a newer one has replaced for its subject; it can no longer be registered.
    mapping(address attester => mapping(bytes32 credId => bool)) public superseded;
    mapping(address subject => Credential) public credentialOf;

    constructor(address initialOwner) Ownable(initialOwner) EIP712("KhataAttesters", "1") {}

    /// @dev Renouncing would make a compromised attester impossible to remove.
    function renounceOwnership() public view override onlyOwner {
        revert OwnershipCannotBeRenounced();
    }

    // ---------- attesters ----------

    function addAttester(address a) external onlyOwner {
        if (a == address(0) || isAttester[a]) revert InvalidAttester();
        isAttester[a] = true;
        emit AttesterAdded(a);
    }

    /// @notice Removing an attester immediately stops every credential and binding it signed from counting.
    function removeAttester(address a) external onlyOwner {
        if (!isAttester[a]) revert InvalidAttester();
        isAttester[a] = false;
        emit AttesterRemoved(a);
    }

    // ---------- digests (public so wallets and scripts can sign exactly what the contract checks) ----------

    function eligibilityDigest(Eligibility memory c) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(ELIGIBILITY_TYPEHASH, c.subject, c.tier, c.jurisdiction, c.validUntil, c.credId))
        );
    }

    function sellerBindingDigest(SellerBinding memory b) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(SELLER_BINDING_TYPEHASH, b.gstinHash, b.wallet, b.validUntil, b.version))
        );
    }

    function revocationDigest(Revocation memory r) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(REVOCATION_TYPEHASH, r.credId)));
    }

    // ---------- credentials ----------

    /// @notice Stores a credential signed by an accepted attester. Anyone may submit it.
    function register(Eligibility calldata c, bytes calldata signature) external {
        address signer = _recover(eligibilityDigest(c), signature);
        if (!isAttester[signer]) revert UnknownAttester(signer);
        if (c.validUntil <= block.timestamp) revert CredentialExpired(c.validUntil);
        if (isRevoked[signer][c.credId]) revert CredentialIsRevoked(c.credId);
        if (superseded[signer][c.credId]) revert CredentialSuperseded(c.credId);

        // The credential being replaced can never come back, so an old signed copy cannot be replayed over a newer one.
        // Replacing one needs the subject or the signing attester: a stranger holding an older, still-valid signed copy
        // (they are published on Arkiv) could otherwise downgrade the subject and burn the newer credential.
        Credential memory old = credentialOf[c.subject];
        if (old.attester != address(0)) {
            bool sameId = old.attester == signer && old.credId == c.credId;
            bool identical = sameId && old.tier == c.tier && old.jurisdiction == c.jurisdiction && old.validUntil == c.validUntil;
            // resubmitting exactly the current credential is harmless; anything else replaces it and needs the subject or attester
            if (!identical && msg.sender != c.subject && msg.sender != signer) revert ReplacementNeedsSubjectOrAttester();
            if (!sameId) superseded[old.attester][old.credId] = true;
        }
        credentialOf[c.subject] = Credential(signer, c.tier, c.jurisdiction, c.validUntil, c.credId);
        emit CredentialRegistered(c.subject, signer, c.credId, c.validUntil);
    }

    /// @notice Applies an attester-signed revocation. Anyone may submit it.
    function revoke(Revocation calldata r, bytes calldata signature) external {
        address signer = _recover(revocationDigest(r), signature);
        if (!isAttester[signer]) revert UnknownAttester(signer);
        isRevoked[signer][r.credId] = true;
        emit CredentialRevoked(signer, r.credId);
    }

    /// @notice Why `who` is or is not eligible right now, and their tier.
    function eligibility(address who) public view returns (Reason, uint8) {
        Credential memory c = credentialOf[who];
        if (c.attester == address(0)) return (Reason.NoCredential, 0);
        if (!isAttester[c.attester]) return (Reason.AttesterRemoved, c.tier);
        if (isRevoked[c.attester][c.credId]) return (Reason.Revoked, c.tier);
        if (block.timestamp >= c.validUntil) return (Reason.Expired, c.tier);
        return (Reason.Eligible, c.tier);
    }

    function isEligible(address who, uint8 minTier) external view returns (bool) {
        (Reason reason, uint8 tier) = eligibility(who);
        return reason == Reason.Eligible && tier >= minTier;
    }

    // ---------- seller binding ----------

    /// @notice Checks an attester-signed binding of a seller GSTIN to a wallet and returns the signing attester.
    function verifySellerBinding(SellerBinding calldata b, bytes calldata signature) external view returns (address) {
        address signer = _recover(sellerBindingDigest(b), signature);
        if (!isAttester[signer]) revert UnknownAttester(signer);
        if (b.validUntil <= block.timestamp) revert CredentialExpired(b.validUntil);
        return signer;
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError) revert InvalidSignature();
        return signer;
    }
}
