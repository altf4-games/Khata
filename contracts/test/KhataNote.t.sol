// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {AttesterRegistry} from "../src/AttesterRegistry.sol";
import {KhataRegistry} from "../src/KhataRegistry.sol";
import {KhataFactory} from "../src/KhataFactory.sol";
import {KhataNote} from "../src/KhataNote.sol";
import {NicInvoice} from "../src/NicInvoice.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";

abstract contract KhataNoteBase is Test {
    uint256 internal constant ATTESTER_PK = 0xA11CE;
    uint64 internal constant COOL_OFF = 1 days;
    uint256 internal constant FACE = 10_000_000; // demo-01: Rs 1,00,000 at 1 micro-USDT per paisa = 10 USDT
    uint32 internal constant DISCOUNT_BPS = 500; // investors pay 95%
    uint64 internal constant GRACE = 7 days;

    string internal constant DEMO_KID = "DEMO-IRP-NOT-GOVERNMENT-1";

    MockUSDT internal usdt;
    AttesterRegistry internal att;
    KhataRegistry internal reg;
    KhataFactory internal factory;
    KhataNote internal note;

    address internal owner = makeAddr("owner");
    address internal seller = makeAddr("seller");
    address internal debtor = makeAddr("debtor");
    address internal stranger = makeAddr("stranger");
    uint256 internal investorPk = 0x1A7E57;
    address internal investor;
    address internal investor2 = makeAddr("investor2");
    address internal outsider = makeAddr("outsider"); // no credential

    uint64 internal boundAt;
    uint64 internal dueDate;
    uint64 internal fundingDeadline;
    bytes32 internal nullifier;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        investor = vm.addr(investorPk);
        usdt = new MockUSDT();
        att = new AttesterRegistry(owner);
        vm.prank(owner);
        att.addAttester(vm.addr(ATTESTER_PK));
        reg = new KhataRegistry(owner, att, COOL_OFF);
        vm.prank(owner);
        reg.addKey(
            DEMO_KID,
            vm.parseBytes(vm.readFile("contracts/test/fixtures/demo-irp/demo-irp.modulus.hex")),
            hex"010001",
            true
        );
        factory = new KhataFactory(usdt, reg, att, 1);

        _registerSeller(keccak256("27DEMOS1234A1Z5"), seller);
        _credential(investor, uint64(block.timestamp + 365 days), 2, keccak256("c-investor"));
        _credential(investor2, uint64(block.timestamp + 365 days), 2, keccak256("c-investor2"));

        vm.prank(seller);
        nullifier = reg.bindInvoice(vm.readFile("contracts/test/fixtures/demo-irp/demo-01.token"));
        boundAt = uint64(block.timestamp);
        dueDate = boundAt + 60 days;
        fundingDeadline = boundAt + 30 days;

        note = _createNote(1);
        usdt.mint(investor, 100_000_000);
        usdt.mint(investor2, 100_000_000);
        usdt.mint(debtor, 100_000_000);
        usdt.mint(stranger, 100_000_000);
    }

    function _terms(uint8 minTier) internal view returns (KhataFactory.Terms memory) {
        return KhataFactory.Terms({
            dueDate: dueDate,
            fundingDeadline: fundingDeadline,
            graceSeconds: GRACE,
            discountBps: DISCOUNT_BPS,
            minTier: minTier
        });
    }

    function _createNote(uint8 minTier) internal returns (KhataNote) {
        vm.prank(seller);
        return KhataNote(factory.createNote(nullifier, _terms(minTier)));
    }

    function _registerSeller(bytes32 gh, address wallet) internal {
        AttesterRegistry.SellerBinding memory b = AttesterRegistry.SellerBinding({
            gstinHash: gh, wallet: wallet, validUntil: uint64(block.timestamp + 365 days), version: 1
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_PK, att.sellerBindingDigest(b));
        reg.registerSeller(b, abi.encodePacked(r, s, v));
    }

    function _credential(address who, uint64 until, uint8 tier, bytes32 id) internal {
        AttesterRegistry.Eligibility memory c =
            AttesterRegistry.Eligibility({subject: who, tier: tier, jurisdiction: 356, validUntil: until, credId: id});
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_PK, att.eligibilityDigest(c));
        att.register(c, abi.encodePacked(r, s, v));
    }

    function _revoke(bytes32 id) internal {
        AttesterRegistry.Revocation memory rv = AttesterRegistry.Revocation({credId: id});
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_PK, att.revocationDigest(rv));
        att.revoke(rv, abi.encodePacked(r, s, v));
    }

    function _open() internal {
        vm.warp(boundAt + COOL_OFF);
    }

    function _fund(address who, uint256 amount) internal {
        uint256 price = note.quote(amount);
        vm.startPrank(who);
        usdt.approve(address(note), price);
        note.fund(amount);
        vm.stopPrank();
    }

    function _settle() internal {
        vm.warp(dueDate);
        vm.startPrank(debtor);
        usdt.approve(address(note), FACE);
        note.settle();
        vm.stopPrank();
    }
}

contract KhataFactoryTest is KhataNoteBase {
    function test_createsANoteWithTheRightFaceValueAndEscrow() public view {
        assertEq(note.faceValue(), FACE);
        assertEq(note.decimals(), 6);
        assertEq(note.totalSupply(), FACE);
        assertEq(note.balanceOf(address(note)), FACE, "all notes start in escrow");
        assertEq(note.seller(), seller);
        assertEq(note.fundableAt(), boundAt + COOL_OFF);
        assertEq(note.dueDate(), dueDate);
        assertEq(factory.noteOf(nullifier), address(note));
        assertEq(address(factory.usdt()), address(usdt));
    }

    function test_unboundInvoiceCannotGetANote() public {
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(KhataFactory.InvoiceNotBound.selector, bytes32(uint256(1))));
        factory.createNote(bytes32(uint256(1)), _terms(1));
    }

    function test_aSecondNoteForTheSameInvoiceIsRefused() public {
        // a second note for the same invoice is refused even from the binder
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(KhataFactory.NoteExists.selector, address(note)));
        factory.createNote(nullifier, _terms(1));
    }

    function test_nonBinderIsRefused() public {
        // bind a second invoice as the seller, then try to wrap it from another wallet
        vm.prank(seller);
        bytes32 n2 = reg.bindInvoice(vm.readFile("contracts/test/fixtures/demo-irp/demo-02.token"));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(KhataFactory.NotBinder.selector, seller));
        factory.createNote(n2, _terms(1));
    }

    function test_termsAreValidated() public {
        vm.prank(seller);
        bytes32 n2 = reg.bindInvoice(vm.readFile("contracts/test/fixtures/demo-irp/demo-02.token"));
        KhataFactory.Terms memory t = _terms(1);

        t.discountBps = 5001;
        vm.prank(seller);
        vm.expectRevert(KhataFactory.InvalidTerms.selector);
        factory.createNote(n2, t);
        t.discountBps = 0; // no discount is allowed

        t.dueDate = uint64(boundAt + COOL_OFF); // due no later than funding opens
        vm.prank(seller);
        vm.expectRevert(KhataFactory.InvalidTerms.selector);
        factory.createNote(n2, t);

        t = _terms(1);
        t.fundingDeadline = dueDate + 1; // funding must end by the due date
        vm.prank(seller);
        vm.expectRevert(KhataFactory.InvalidTerms.selector);
        factory.createNote(n2, t);

        t = _terms(1);
        t.fundingDeadline = boundAt + COOL_OFF; // must end after funding opens
        vm.prank(seller);
        vm.expectRevert(KhataFactory.InvalidTerms.selector);
        factory.createNote(n2, t);

        t = _terms(1);
        t.graceSeconds = 91 days;
        vm.prank(seller);
        vm.expectRevert(KhataFactory.InvalidTerms.selector);
        factory.createNote(n2, t);

        t = _terms(1);
        t.discountBps = 0;
        vm.prank(seller);
        factory.createNote(n2, t);
    }

    function test_faceValueUsesTheFactoryRate() public {
        KhataFactory f2 = new KhataFactory(usdt, reg, att, 113);
        vm.prank(seller);
        bytes32 n2 = reg.bindInvoice(vm.readFile("contracts/test/fixtures/demo-irp/demo-03.token")); // Rs 75,000
        vm.prank(seller);
        KhataNote n = KhataNote(f2.createNote(n2, _terms(1)));
        assertEq(n.faceValue(), 7_500_000 * 113);
    }
}

contract KhataNoteFundTest is KhataNoteBase {
    function test_fundingWaitsForTheCoolOff() public {
        vm.warp(boundAt + COOL_OFF - 1);
        vm.startPrank(investor);
        usdt.approve(address(note), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.CoolOffActive.selector, boundAt + COOL_OFF));
        note.fund(1_000_000);
        vm.warp(boundAt + COOL_OFF); // exactly at the boundary it opens
        note.fund(1_000_000);
        vm.stopPrank();
    }

    function test_fundIsAtomicDeliveryVersusPayment() public {
        _open();
        uint256 amount = 4_000_000;
        uint256 price = note.quote(amount);
        assertEq(price, 3_800_000, "5% discount");

        uint256 sellerBefore = usdt.balanceOf(seller);
        uint256 investorBefore = usdt.balanceOf(investor);
        _fund(investor, amount);

        assertEq(usdt.balanceOf(seller), sellerBefore + price, "the seller is paid at once");
        assertEq(usdt.balanceOf(investor), investorBefore - price);
        assertEq(note.balanceOf(investor), amount, "and the investor holds the notes");
        assertEq(note.balanceOf(address(note)), FACE - amount);
        assertEq(note.fundedFace(), amount);
        assertEq(usdt.balanceOf(address(note)), 0, "the note never holds the payment");
    }

    function test_noNotesWithoutPayment() public {
        _open();
        vm.prank(investor); // no approval
        vm.expectRevert();
        note.fund(1_000_000);
        assertEq(note.balanceOf(investor), 0);
        assertEq(note.fundedFace(), 0);
    }

    function test_priceRoundsUpSoNoOneGetsFreeNotes() public {
        _open();
        assertEq(note.quote(1), 1, "1 unit costs at least 1");
        assertEq(note.quote(3), 3); // 3 * 0.95 = 2.85 -> 3
        assertEq(note.quote(21), 20); // 19.95 -> 20
        assertEq(note.quote(20), 19);
        for (uint256 a = 1; a < 200; ++a) {
            assertGe(note.quote(a) * 10_000, a * 9_500, "never below the exact price");
        }
    }

    function test_partialFillsAndNoOverFunding() public {
        _open();
        _fund(investor, 6_000_000);
        _fund(investor2, 3_000_000);
        assertEq(note.balanceOf(address(note)), 1_000_000);

        vm.startPrank(investor);
        usdt.approve(address(note), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.ExceedsAvailable.selector, 1_000_000));
        note.fund(1_000_001);
        note.fund(1_000_000); // exactly the rest
        vm.stopPrank();
        assertEq(note.balanceOf(address(note)), 0);
        assertEq(note.fundedFace(), FACE);
        assertEq(note.totalSupply(), FACE, "supply never exceeds face");
    }

    function test_zeroAmountIsRefused() public {
        _open();
        vm.prank(investor);
        vm.expectRevert(KhataNote.ZeroAmount.selector);
        note.fund(0);
    }

    function test_investorWithoutACredentialIsRefused() public {
        _open();
        usdt.mint(outsider, 10_000_000);
        vm.startPrank(outsider);
        usdt.approve(address(note), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(
                KhataNote.ReceiverNotEligible.selector, outsider, AttesterRegistry.Reason.NoCredential
            )
        );
        note.fund(1_000_000);
        vm.stopPrank();
        assertEq(usdt.balanceOf(outsider), 10_000_000, "nothing was taken");
    }

    function test_tierBelowTheNoteMinimumIsRefused() public {
        KhataNote strict = _createStrictNote();
        _open();
        vm.startPrank(investor);
        usdt.approve(address(strict), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.ReceiverTierTooLow.selector, investor, 2, 3));
        strict.fund(1_000_000);
        vm.stopPrank();
    }

    function _createStrictNote() internal returns (KhataNote) {
        vm.prank(seller);
        bytes32 n2 = reg.bindInvoice(vm.readFile("contracts/test/fixtures/demo-irp/demo-04.token"));
        vm.prank(seller);
        return KhataNote(factory.createNote(n2, _terms(3)));
    }

    function test_expiredAndRevokedCredentialsCannotFund() public {
        _open();
        _revoke(keccak256("c-investor2"));
        vm.startPrank(investor2);
        usdt.approve(address(note), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(KhataNote.ReceiverNotEligible.selector, investor2, AttesterRegistry.Reason.Revoked)
        );
        note.fund(1_000_000);
        vm.stopPrank();

        vm.warp(block.timestamp + 366 days);
        vm.startPrank(investor);
        usdt.approve(address(note), type(uint256).max);
        // both the funding window and the credential are over; the window check comes first
        vm.expectRevert(abi.encodeWithSelector(KhataNote.FundingEnded.selector, fundingDeadline));
        note.fund(1_000_000);
        vm.stopPrank();
    }

    function test_fundingEndsAtTheDeadline() public {
        vm.warp(fundingDeadline);
        _fund(investor, 1_000_000); // at the deadline is still open
        vm.warp(fundingDeadline + 1);
        vm.startPrank(investor);
        usdt.approve(address(note), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.FundingEnded.selector, fundingDeadline));
        note.fund(1_000_000);
        vm.stopPrank();
    }

    function test_fundWithPermitNeedsNoSeparateApproval() public {
        _open();
        uint256 amount = 2_000_000;
        uint256 price = note.quote(amount);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                investor,
                address(note),
                price,
                usdt.nonces(investor),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(investorPk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), structHash)));
        vm.prank(investor);
        note.fundWithPermit(amount, deadline, v, r, s);
        assertEq(note.balanceOf(investor), amount);
    }

    /// Anyone can front-run a permit by submitting it first; the funding must still succeed.
    function test_permitFrontRunDoesNotBlockFunding() public {
        _open();
        uint256 amount = 2_000_000;
        uint256 price = note.quote(amount);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                investor,
                address(note),
                price,
                usdt.nonces(investor),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(investorPk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), structHash)));
        vm.prank(stranger);
        usdt.permit(investor, address(note), price, deadline, v, r, s); // the front-runner uses the signature first
        vm.prank(investor);
        note.fundWithPermit(amount, deadline, v, r, s);
        assertEq(note.balanceOf(investor), amount);
    }

    function test_cannotFundAfterFundingIsClosed() public {
        _open();
        vm.prank(seller);
        note.closeFunding();
        vm.startPrank(investor);
        usdt.approve(address(note), type(uint256).max);
        vm.expectRevert(KhataNote.FundingClosed.selector);
        note.fund(1_000_000);
        vm.stopPrank();
    }

    function test_onlyTheSellerClosesFundingEarly() public {
        _open();
        vm.prank(stranger);
        vm.expectRevert(KhataNote.NotSellerOrFundingOpen.selector);
        note.closeFunding();

        _fund(investor, 3_000_000);
        vm.prank(seller);
        note.closeFunding();
        assertEq(note.totalSupply(), 3_000_000, "unsold notes are burned");
        assertEq(note.balanceOf(address(note)), 0);
    }

    function test_anyoneMayCloseFundingAfterTheDeadline() public {
        _open();
        _fund(investor, 3_000_000);
        vm.warp(fundingDeadline + 1);
        vm.prank(stranger);
        note.closeFunding();
        assertEq(note.totalSupply(), 3_000_000);
        vm.expectRevert(KhataNote.FundingClosed.selector);
        vm.prank(stranger);
        note.closeFunding();
    }
}

contract KhataNoteTransferTest is KhataNoteBase {
    function setUp() public override {
        super.setUp();
        _open();
        _fund(investor, 5_000_000);
    }

    function test_transferToAnEligibleHolderWorks() public {
        vm.prank(investor);
        note.transfer(investor2, 1_000_000);
        assertEq(note.balanceOf(investor2), 1_000_000);
    }

    function test_transferToSomeoneWithoutACredentialIsBlockedWithAReason() public {
        vm.prank(investor);
        vm.expectRevert(
            abi.encodeWithSelector(
                KhataNote.ReceiverNotEligible.selector, outsider, AttesterRegistry.Reason.NoCredential
            )
        );
        note.transfer(outsider, 1_000_000);

        (bool ok, string memory why) = note.explainTransfer(investor, outsider, 1_000_000);
        assertFalse(ok);
        assertEq(why, "The receiver has no credential from an accepted attester.");
        assertEq(note.balanceOf(investor), 5_000_000, "nothing moved");
    }

    function test_readableReasonsForEveryBlockedCase() public {
        (bool ok, string memory why) = note.explainTransfer(investor, investor2, 1);
        assertTrue(ok);
        assertEq(why, "Allowed.");

        _revoke(keccak256("c-investor2"));
        (ok, why) = note.explainTransfer(investor, investor2, 1);
        assertFalse(ok);
        assertEq(why, "The receiver's credential was revoked by its attester.");

        address third = makeAddr("third");
        _credential(third, uint64(block.timestamp + 100), 2, keccak256("c-third"));
        vm.warp(block.timestamp + 100);
        (ok, why) = note.explainTransfer(investor, third, 1);
        assertFalse(ok);
        assertEq(why, "The receiver's credential has expired.");

        (ok, why) = note.explainTransfer(investor, address(note), 1);
        assertFalse(ok);
        assertEq(why, "Notes cannot be sent to the note contract itself.");

        (ok, why) = note.explainTransfer(investor, address(0), 1);
        assertFalse(ok);
        assertEq(why, "Notes cannot be sent to the zero address.");

        vm.warp(dueDate);
        (ok, why) = note.explainTransfer(investor, investor2, 1);
        assertFalse(ok);
        assertEq(why, "Transfers stop at maturity.");
    }

    function test_tierReasonIsExplained() public {
        vm.prank(seller);
        bytes32 n2 = reg.bindInvoice(vm.readFile("contracts/test/fixtures/demo-irp/demo-04.token"));
        vm.prank(seller);
        KhataNote strict = KhataNote(factory.createNote(n2, _terms(3)));
        (bool ok, string memory why) = strict.explainTransfer(investor, investor2, 1);
        assertFalse(ok);
        assertEq(why, "The receiver's credential tier is below the minimum for this note.");
    }

    function test_removedAttesterReasonIsExplained() public {
        vm.prank(owner);
        att.removeAttester(vm.addr(ATTESTER_PK));
        (bool ok, string memory why) = note.explainTransfer(investor, investor2, 1);
        assertFalse(ok);
        assertEq(why, "The attester that issued the receiver's credential is no longer trusted.");
    }

    /// The credential check happens at every transfer: revoke, then transfer.
    function test_revokeThenTransferIsBlocked() public {
        _revoke(keccak256("c-investor2"));
        vm.prank(investor);
        vm.expectRevert(
            abi.encodeWithSelector(KhataNote.ReceiverNotEligible.selector, investor2, AttesterRegistry.Reason.Revoked)
        );
        note.transfer(investor2, 1_000_000);
    }

    /// The rule checks the receiver only. A holder whose own credential was revoked keeps the notes and may still sell them
    /// on to an eligible holder, so a revocation can never trap funds. Pinned here so the behaviour is deliberate.
    function test_aRevokedHolderMayStillSellToAnEligibleReceiver() public {
        _revoke(keccak256("c-investor"));
        vm.prank(investor);
        note.transfer(investor2, 1_000_000);
        assertEq(note.balanceOf(investor2) >= 1_000_000, true);
    }

    /// A credential expiring mid-hold: the holder keeps the notes but can no longer receive more.
    function test_credentialExpiringMidHold() public {
        address third = makeAddr("third");
        uint64 until = uint64(block.timestamp + 10 days);
        _credential(third, until, 2, keccak256("c-third"));
        vm.prank(investor);
        note.transfer(third, 1_000_000);

        vm.warp(until - 1);
        vm.prank(investor);
        note.transfer(third, 1_000_000); // still valid one second before

        vm.warp(until);
        vm.prank(investor);
        vm.expectRevert(
            abi.encodeWithSelector(KhataNote.ReceiverNotEligible.selector, third, AttesterRegistry.Reason.Expired)
        );
        note.transfer(third, 1_000_000);
        assertEq(note.balanceOf(third), 2_000_000, "they keep what they hold");

        // and they can still send it on to an eligible holder
        vm.prank(third);
        note.transfer(investor, 2_000_000);
    }

    function test_transfersStopAtMaturity() public {
        vm.warp(dueDate - 1);
        vm.prank(investor);
        note.transfer(investor2, 1_000_000);
        vm.warp(dueDate);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.TransferAfterMaturity.selector, dueDate));
        note.transfer(investor2, 1_000_000);
    }

    function test_cannotSendToZeroOrToTheNote() public {
        vm.startPrank(investor);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        note.transfer(address(0), 1);
        vm.expectRevert(KhataNote.ReceiverIsNote.selector);
        note.transfer(address(note), 1);
        vm.stopPrank();
    }

    function test_transferFromAlsoObeysTheRules() public {
        vm.prank(investor);
        note.approve(stranger, 1_000_000);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                KhataNote.ReceiverNotEligible.selector, outsider, AttesterRegistry.Reason.NoCredential
            )
        );
        note.transferFrom(investor, outsider, 1_000_000);
    }
}

contract KhataNoteLifecycleTest is KhataNoteBase {
    function setUp() public override {
        super.setUp();
        _open();
        _fund(investor, 6_000_000);
        _fund(investor2, 2_000_000); // 2 USDT of 10 stays unsold
    }

    function test_settleNotBeforeTheDueDate() public {
        vm.warp(dueDate - 1);
        vm.startPrank(debtor);
        usdt.approve(address(note), FACE);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.NotYetDue.selector, dueDate));
        note.settle();
        vm.stopPrank();
    }

    function test_anyoneMaySettleOnTheDebtorsBehalfAndFundsFlowCorrectly() public {
        uint256 sellerBefore = usdt.balanceOf(seller);
        vm.warp(dueDate); // exactly on the due date
        vm.startPrank(stranger);
        usdt.approve(address(note), FACE);
        note.settle();
        vm.stopPrank();

        assertEq(uint8(note.phase()), uint8(KhataNote.Phase.Settled));
        // the unsold 2 USDT of face value goes to the seller; the 8 USDT of funded notes wait for redemption
        assertEq(usdt.balanceOf(seller), sellerBefore + 2_000_000);
        assertEq(usdt.balanceOf(address(note)), 8_000_000);
        assertEq(note.totalSupply(), 8_000_000, "unsold notes were burned");
    }

    function test_settleNeedsTheFullFaceValueAndCannotRepeat() public {
        vm.warp(dueDate);
        address poor = makeAddr("poor");
        usdt.mint(poor, FACE - 1);
        vm.startPrank(poor);
        usdt.approve(address(note), FACE);
        vm.expectRevert(); // ERC20 insufficient balance: no partial settlement
        note.settle();
        vm.stopPrank();
        assertEq(uint8(note.phase()), uint8(KhataNote.Phase.Funding));

        _settle();
        vm.startPrank(debtor);
        usdt.approve(address(note), FACE);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.WrongPhase.selector, KhataNote.Phase.Settled));
        note.settle();
        vm.stopPrank();
    }

    function test_redeemPaysHoldersTheirNotesInFull() public {
        _settle();
        uint256 before1 = usdt.balanceOf(investor);
        vm.prank(investor);
        note.redeem();
        assertEq(usdt.balanceOf(investor), before1 + 6_000_000, "they paid 5.7 USDT and receive 6 USDT");
        assertEq(note.balanceOf(investor), 0);

        vm.prank(investor2);
        note.redeem();
        assertEq(usdt.balanceOf(address(note)), 0, "everything paid out, no dust");
        assertEq(note.totalSupply(), 0);
    }

    function test_noDoubleRedeemAndNoRedeemBeforeSettlement() public {
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.WrongPhase.selector, KhataNote.Phase.Funding));
        note.redeem();

        _settle();
        vm.prank(investor);
        note.redeem();
        vm.prank(investor);
        vm.expectRevert(KhataNote.NothingToRedeem.selector);
        note.redeem();
        vm.prank(stranger);
        vm.expectRevert(KhataNote.NothingToRedeem.selector);
        note.redeem();
    }

    /// A holder whose credential expired or was revoked is still paid.
    function test_redeemDoesNotNeedAValidCredential() public {
        _revoke(keccak256("c-investor"));
        _settle();
        vm.prank(investor);
        note.redeem();
        assertEq(note.balanceOf(investor), 0);
    }

    function test_defaultAfterDueDatePlusGrace() public {
        vm.warp(dueDate + GRACE);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.NotInDefault.selector, dueDate + GRACE + 1));
        note.markDefault();
        vm.warp(dueDate + GRACE + 1);
        vm.prank(stranger);
        note.markDefault();
        assertEq(uint8(note.phase()), uint8(KhataNote.Phase.Defaulted));
        assertEq(note.totalSupply(), 8_000_000, "unsold notes burned on default");
    }

    function test_afterDefaultNothingMovesAndNobodyIsPaid() public {
        vm.warp(dueDate + GRACE + 1);
        note.markDefault();

        vm.startPrank(debtor);
        usdt.approve(address(note), FACE);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.WrongPhase.selector, KhataNote.Phase.Defaulted));
        note.settle();
        vm.stopPrank();

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.WrongPhase.selector, KhataNote.Phase.Defaulted));
        note.redeem();

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.TransferAfterMaturity.selector, dueDate));
        note.transfer(investor2, 1);

        vm.expectRevert(abi.encodeWithSelector(KhataNote.WrongPhase.selector, KhataNote.Phase.Defaulted));
        note.markDefault();
        assertEq(usdt.balanceOf(address(note)), 0);
    }

    function test_lateSettlementIsAcceptedUntilDefaultIsMarked() public {
        vm.warp(dueDate + GRACE + 5 days); // overdue but nobody called markDefault yet
        vm.startPrank(debtor);
        usdt.approve(address(note), FACE);
        note.settle();
        vm.stopPrank();
        assertEq(uint8(note.phase()), uint8(KhataNote.Phase.Settled));
    }

    function test_cannotMarkDefaultOnASettledNote() public {
        _settle();
        vm.warp(dueDate + GRACE + 1);
        vm.expectRevert(abi.encodeWithSelector(KhataNote.WrongPhase.selector, KhataNote.Phase.Settled));
        note.markDefault();
    }

    function test_settleWorksEvenIfFundingWasNeverClosedOrDone() public {
        // a note nobody funded: the seller simply collects the full face value
        vm.prank(seller);
        bytes32 n2 = reg.bindInvoice(vm.readFile("contracts/test/fixtures/demo-irp/demo-05.token"));
        vm.prank(seller);
        KhataNote empty = KhataNote(factory.createNote(n2, _terms(1)));
        vm.warp(dueDate);
        uint256 face = empty.faceValue();
        uint256 before = usdt.balanceOf(seller);
        vm.startPrank(debtor);
        usdt.approve(address(empty), face);
        empty.settle();
        vm.stopPrank();
        assertEq(usdt.balanceOf(seller), before + face);
        assertEq(empty.totalSupply(), 0);
    }
}
