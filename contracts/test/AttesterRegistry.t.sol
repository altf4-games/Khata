// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AttesterRegistry} from "../src/AttesterRegistry.sol";

contract AttesterRegistryTest is Test {
    AttesterRegistry internal att;

    address internal owner = makeAddr("owner");
    address internal investor = makeAddr("investor");
    address internal stranger = makeAddr("stranger");
    uint256 internal attesterPk = 0xA11CE;
    address internal attester;
    uint256 internal rogueAttesterPk = 0xB0B;
    address internal rogue;

    bytes32 internal constant CRED = keccak256("cred-1");

    event AttesterAdded(address indexed attester);
    event AttesterRemoved(address indexed attester);
    event CredentialRegistered(
        address indexed subject, address indexed attester, bytes32 indexed credId, uint64 validUntil
    );
    event CredentialRevoked(address indexed attester, bytes32 indexed credId);

    function setUp() public {
        vm.warp(1_000_000);
        attester = vm.addr(attesterPk);
        rogue = vm.addr(rogueAttesterPk);
        att = new AttesterRegistry(owner);
        vm.prank(owner);
        att.addAttester(attester);
    }

    function _cred(address subject, uint64 validUntil, bytes32 id)
        internal
        pure
        returns (AttesterRegistry.Eligibility memory)
    {
        return AttesterRegistry.Eligibility({
            subject: subject, tier: 2, jurisdiction: 356, validUntil: validUntil, credId: id
        });
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _register(address subject, uint64 validUntil, bytes32 id)
        internal
        returns (AttesterRegistry.Eligibility memory c)
    {
        c = _cred(subject, validUntil, id);
        att.register(c, _sign(attesterPk, att.eligibilityDigest(c)));
    }

    // ---------- attesters ----------

    function test_ownerManagesAttesters() public {
        address a2 = makeAddr("a2");
        vm.expectEmit(true, false, false, false);
        emit AttesterAdded(a2);
        vm.prank(owner);
        att.addAttester(a2);
        assertTrue(att.isAttester(a2));

        vm.expectEmit(true, false, false, false);
        emit AttesterRemoved(a2);
        vm.prank(owner);
        att.removeAttester(a2);
        assertFalse(att.isAttester(a2));
    }

    function test_onlyOwnerManagesAttesters() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        att.addAttester(stranger);
    }

    function test_cannotAddZeroOrDuplicateAttester() public {
        vm.startPrank(owner);
        vm.expectRevert(AttesterRegistry.InvalidAttester.selector);
        att.addAttester(address(0));
        vm.expectRevert(AttesterRegistry.InvalidAttester.selector);
        att.addAttester(attester);
        vm.expectRevert(AttesterRegistry.InvalidAttester.selector);
        att.removeAttester(stranger);
        vm.stopPrank();
    }

    function test_ownershipCannotBeRenounced() public {
        vm.prank(owner);
        vm.expectRevert(AttesterRegistry.OwnershipCannotBeRenounced.selector);
        att.renounceOwnership();
    }

    // ---------- credentials ----------

    function test_registersAValidCredential() public {
        AttesterRegistry.Eligibility memory c = _cred(investor, uint64(block.timestamp + 1 days), CRED);
        bytes memory sig = _sign(attesterPk, att.eligibilityDigest(c));
        vm.expectEmit(true, true, true, true);
        emit CredentialRegistered(investor, attester, CRED, c.validUntil);
        vm.prank(stranger); // anyone may submit; the signature is what matters
        att.register(c, sig);

        (AttesterRegistry.Reason reason, uint8 tier) = att.eligibility(investor);
        assertEq(uint8(reason), uint8(AttesterRegistry.Reason.Eligible));
        assertEq(tier, 2);
        assertTrue(att.isEligible(investor, 2));
        assertFalse(att.isEligible(investor, 3));
    }

    function test_noCredentialMeansNoCredentialReason() public view {
        (AttesterRegistry.Reason reason,) = att.eligibility(investor);
        assertEq(uint8(reason), uint8(AttesterRegistry.Reason.NoCredential));
    }

    function test_rejectsCredentialSignedByANonAttester() public {
        AttesterRegistry.Eligibility memory c = _cred(investor, uint64(block.timestamp + 1 days), CRED);
        bytes memory sig = _sign(rogueAttesterPk, att.eligibilityDigest(c));
        vm.expectRevert(abi.encodeWithSelector(AttesterRegistry.UnknownAttester.selector, rogue));
        att.register(c, sig);
    }

    function test_rejectsTamperedCredentialFields() public {
        AttesterRegistry.Eligibility memory c = _cred(investor, uint64(block.timestamp + 1 days), CRED);
        bytes memory sig = _sign(attesterPk, att.eligibilityDigest(c));
        c.tier = 9; // signature was for tier 2: recovers a different, unknown address
        vm.expectRevert();
        att.register(c, sig);
    }

    function test_rejectsMalformedSignature() public {
        AttesterRegistry.Eligibility memory c = _cred(investor, uint64(block.timestamp + 1 days), CRED);
        vm.expectRevert(AttesterRegistry.InvalidSignature.selector);
        att.register(c, hex"1234");
    }

    function test_rejectsAlreadyExpiredCredential() public {
        AttesterRegistry.Eligibility memory c = _cred(investor, uint64(block.timestamp), CRED); // exactly now
        bytes memory sig = _sign(attesterPk, att.eligibilityDigest(c));
        vm.expectRevert(abi.encodeWithSelector(AttesterRegistry.CredentialExpired.selector, c.validUntil));
        att.register(c, sig);
    }

    function test_expiryBoundary() public {
        uint64 until = uint64(block.timestamp + 100);
        _register(investor, until, CRED);
        vm.warp(until - 1);
        assertTrue(att.isEligible(investor, 0), "valid one second before expiry");
        vm.warp(until);
        assertFalse(att.isEligible(investor, 0), "expired exactly at validUntil");
        (AttesterRegistry.Reason reason,) = att.eligibility(investor);
        assertEq(uint8(reason), uint8(AttesterRegistry.Reason.Expired));
    }

    function test_removingAnAttesterInvalidatesTheirCredentials() public {
        _register(investor, uint64(block.timestamp + 1 days), CRED);
        vm.prank(owner);
        att.removeAttester(attester);
        (AttesterRegistry.Reason reason,) = att.eligibility(investor);
        assertEq(uint8(reason), uint8(AttesterRegistry.Reason.AttesterRemoved));
    }

    /// Red-team C4: after a credential is replaced, resubmitting the old signed one must not bring it back.
    function test_aReplacedCredentialCannotBeReplayed() public {
        AttesterRegistry.Eligibility memory high = _cred(investor, uint64(block.timestamp + 1 days), keccak256("high"));
        high.tier = 3;
        bytes memory highSig = _sign(attesterPk, att.eligibilityDigest(high));
        att.register(high, highSig);
        AttesterRegistry.Eligibility memory low = _cred(investor, uint64(block.timestamp + 1 days), keccak256("low"));
        low.tier = 1;
        bytes memory lowSig = _sign(attesterPk, att.eligibilityDigest(low));
        vm.prank(investor);
        att.register(low, lowSig);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AttesterRegistry.CredentialSuperseded.selector, high.credId));
        att.register(high, highSig);
        (, uint8 tier) = att.eligibility(investor);
        assertEq(tier, 1, "the downgrade stands");
    }

    /// Red-team 2: a third party replaying an older still-valid credential must neither downgrade the subject nor
    /// burn the newer credential.
    function test_aStrangerCannotReplayAnOlderCredentialOverANewerOne() public {
        AttesterRegistry.Eligibility memory older = _cred(investor, uint64(block.timestamp + 1 days), keccak256("older"));
        older.tier = 1;
        bytes memory olderSig = _sign(attesterPk, att.eligibilityDigest(older));
        AttesterRegistry.Eligibility memory newer = _cred(investor, uint64(block.timestamp + 2 days), keccak256("newer"));
        newer.tier = 3;
        att.register(newer, _sign(attesterPk, att.eligibilityDigest(newer)));

        vm.prank(stranger);
        vm.expectRevert(AttesterRegistry.ReplacementNeedsSubjectOrAttester.selector);
        att.register(older, olderSig);

        (, uint8 tier) = att.eligibility(investor);
        assertEq(tier, 3, "the newer credential stays current");
        assertFalse(att.superseded(attester, newer.credId), "and is not burned");
    }

    function test_theSubjectOrTheAttesterMayReplaceAndAStrangerMayStillGiveTheFirstCredential() public {
        // first credential: anyone may submit it
        AttesterRegistry.Eligibility memory first = _cred(investor, uint64(block.timestamp + 1 days), keccak256("first"));
        bytes memory firstSig = _sign(attesterPk, att.eligibilityDigest(first));
        vm.prank(stranger);
        att.register(first, firstSig);

        AttesterRegistry.Eligibility memory second = _cred(investor, uint64(block.timestamp + 1 days), keccak256("second"));
        second.tier = 3;
        bytes memory secondSig = _sign(attesterPk, att.eligibilityDigest(second));
        vm.prank(attester);
        att.register(second, secondSig);
        (, uint8 tier) = att.eligibility(investor);
        assertEq(tier, 3);

        AttesterRegistry.Eligibility memory third = _cred(investor, uint64(block.timestamp + 1 days), keccak256("third"));
        third.tier = 1;
        bytes memory thirdSig = _sign(attesterPk, att.eligibilityDigest(third));
        vm.prank(investor);
        att.register(third, thirdSig);
        (, tier) = att.eligibility(investor);
        assertEq(tier, 1);
    }

    function test_resubmittingTheCurrentCredentialChangesNothing() public {
        AttesterRegistry.Eligibility memory c = _register(investor, uint64(block.timestamp + 1 days), CRED);
        att.register(c, _sign(attesterPk, att.eligibilityDigest(c)));
        assertTrue(att.isEligible(investor, 0));
    }

    // ---------- revocation ----------

    function test_revocationByTheAttesterAppliesAndAnyoneMaySubmit() public {
        AttesterRegistry.Eligibility memory c = _register(investor, uint64(block.timestamp + 1 days), CRED);
        AttesterRegistry.Revocation memory r = AttesterRegistry.Revocation({credId: CRED});
        bytes memory sig = _sign(attesterPk, att.revocationDigest(r));

        vm.expectEmit(true, true, false, false);
        emit CredentialRevoked(attester, CRED);
        vm.prank(stranger);
        att.revoke(r, sig);

        (AttesterRegistry.Reason reason,) = att.eligibility(investor);
        assertEq(uint8(reason), uint8(AttesterRegistry.Reason.Revoked));
        assertTrue(att.isRevoked(attester, CRED));

        // a revoked credential cannot be registered again
        bytes memory again = _sign(attesterPk, att.eligibilityDigest(c));
        vm.expectRevert(abi.encodeWithSelector(AttesterRegistry.CredentialIsRevoked.selector, CRED));
        att.register(c, again);
    }

    function test_revocationSignedByANonAttesterIsRefused() public {
        _register(investor, uint64(block.timestamp + 1 days), CRED);
        AttesterRegistry.Revocation memory r = AttesterRegistry.Revocation({credId: CRED});
        bytes memory sig = _sign(rogueAttesterPk, att.revocationDigest(r));
        vm.expectRevert(abi.encodeWithSelector(AttesterRegistry.UnknownAttester.selector, rogue));
        att.revoke(r, sig);
        assertTrue(att.isEligible(investor, 0));
    }

    /// One attester cannot revoke another attester's credential by reusing its id.
    function test_attestersRevokeOnlyTheirOwnCredentials() public {
        vm.prank(owner);
        att.addAttester(rogue);
        _register(investor, uint64(block.timestamp + 1 days), CRED);
        AttesterRegistry.Revocation memory r = AttesterRegistry.Revocation({credId: CRED});
        att.revoke(r, _sign(rogueAttesterPk, att.revocationDigest(r)));
        assertTrue(att.isEligible(investor, 0), "the real attester's credential is untouched");
    }

    /// A revoked attester signature must not be accepted a second time as a new credential for someone else.
    function test_credentialIsBoundToItsSubject() public {
        AttesterRegistry.Eligibility memory c = _cred(investor, uint64(block.timestamp + 1 days), CRED);
        bytes memory sig = _sign(attesterPk, att.eligibilityDigest(c));
        c.subject = stranger; // someone tries to claim the investor's credential
        vm.expectRevert();
        att.register(c, sig);
    }

    // ---------- seller binding ----------

    function _binding(bytes32 gh, address wallet, uint64 until, uint64 version)
        internal
        pure
        returns (AttesterRegistry.SellerBinding memory)
    {
        return AttesterRegistry.SellerBinding({gstinHash: gh, wallet: wallet, validUntil: until, version: version});
    }

    function test_verifiesASellerBinding() public view {
        AttesterRegistry.SellerBinding memory b =
            _binding(keccak256("GSTIN"), investor, uint64(block.timestamp + 1 days), 1);
        address signer = att.verifySellerBinding(b, _sign(attesterPk, att.sellerBindingDigest(b)));
        assertEq(signer, attester);
    }

    function test_sellerBindingRejectsUnknownSignerAndExpiry() public {
        AttesterRegistry.SellerBinding memory b =
            _binding(keccak256("GSTIN"), investor, uint64(block.timestamp + 1 days), 1);
        bytes memory rogueSig = _sign(rogueAttesterPk, att.sellerBindingDigest(b));
        vm.expectRevert(abi.encodeWithSelector(AttesterRegistry.UnknownAttester.selector, rogue));
        att.verifySellerBinding(b, rogueSig);

        b.validUntil = uint64(block.timestamp);
        bytes memory expiredSig = _sign(attesterPk, att.sellerBindingDigest(b));
        vm.expectRevert(abi.encodeWithSelector(AttesterRegistry.CredentialExpired.selector, b.validUntil));
        att.verifySellerBinding(b, expiredSig);
    }

    function test_domainSeparatorIsBoundToChainAndContract() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = att.eip712Domain();
        assertEq(name, "KhataAttesters");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(att));
    }
}
