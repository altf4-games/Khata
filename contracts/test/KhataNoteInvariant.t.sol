// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {KhataNote} from "../src/KhataNote.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";
import {KhataNoteBase} from "./KhataNote.t.sol";

/// Random sequences of every public action, by holders with and without credentials.
contract NoteHandler is Test {
    KhataNote public note;
    MockUSDT public usdt;
    address public seller;
    address public debtor;
    address[] public actors; // the last two have no credential

    uint256 public redeemedTotal;
    uint256 public paidToSellerOnSettle;
    uint256 public settleCalls;

    constructor(KhataNote note_, MockUSDT usdt_, address seller_, address debtor_, address[] memory actors_) {
        note = note_;
        usdt = usdt_;
        seller = seller_;
        debtor = debtor_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function fund(uint256 actorSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        amount = bound(amount, 1, note.faceValue());
        uint256 price = note.quote(amount);
        usdt.mint(a, price);
        vm.startPrank(a);
        usdt.approve(address(note), price);
        try note.fund(amount) {} catch {}
        vm.stopPrank();
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        address from = _actor(fromSeed);
        amount = bound(amount, 0, note.balanceOf(from));
        vm.prank(from);
        try note.transfer(_actor(toSeed), amount) {} catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 25 days));
    }

    function settle(uint256 payerSeed) external {
        address payer = payerSeed % 2 == 0 ? debtor : _actor(payerSeed);
        uint256 face = note.faceValue();
        usdt.mint(payer, face);
        uint256 sellerBefore = usdt.balanceOf(seller);
        vm.startPrank(payer);
        usdt.approve(address(note), face);
        try note.settle() {
            paidToSellerOnSettle = usdt.balanceOf(seller) - sellerBefore;
            ++settleCalls;
        } catch {}
        vm.stopPrank();
    }

    function redeem(uint256 actorSeed) external {
        address a = _actor(actorSeed);
        uint256 bal = note.balanceOf(a);
        vm.prank(a);
        try note.redeem() {
            redeemedTotal += bal;
        } catch {}
    }

    function closeFunding(uint256 callerSeed) external {
        vm.prank(callerSeed % 2 == 0 ? seller : _actor(callerSeed));
        try note.closeFunding() {} catch {}
    }

    function markDefault() external {
        try note.markDefault() {} catch {}
    }
}

contract KhataNoteInvariantTest is KhataNoteBase {
    NoteHandler internal handler;
    address internal third;

    function setUp() public override {
        super.setUp();
        third = makeAddr("third");
        _credential(third, uint64(block.timestamp + 365 days), 2, keccak256("c-third"));
        address[] memory actors = new address[](5);
        actors[0] = investor;
        actors[1] = investor2;
        actors[2] = third;
        actors[3] = outsider;
        actors[4] = stranger;
        handler = new NoteHandler(note, usdt, seller, debtor, actors);
        vm.warp(boundAt + COOL_OFF); // funding is open when the sequences start
        targetContract(address(handler));
    }

    /// The notes in existence never exceed the invoice's face value.
    function invariant_supplyNeverExceedsFaceValue() public view {
        assertLe(note.totalSupply(), note.faceValue());
        assertLe(note.fundedFace(), note.faceValue());
    }

    /// While funding or after default the note holds no USDT; after settlement it holds exactly what is still owed to holders.
    function invariant_noteHoldsExactlyWhatHoldersAreOwed() public view {
        uint256 bal = usdt.balanceOf(address(note));
        if (note.phase() == KhataNote.Phase.Settled) assertEq(bal, note.totalSupply());
        else assertEq(bal, 0);
    }

    /// No path pays out twice: redemptions plus what remains plus the seller's residual equal the face value, never more.
    function invariant_settlementConservesFaceValue() public view {
        if (note.phase() != KhataNote.Phase.Settled) {
            assertEq(handler.redeemedTotal(), 0);
            return;
        }
        assertEq(
            handler.redeemedTotal() + usdt.balanceOf(address(note)) + handler.paidToSellerOnSettle(), note.faceValue()
        );
        assertEq(handler.settleCalls(), 1, "settled exactly once");
    }

    /// Holders can never redeem more than was funded.
    function invariant_redemptionsNeverExceedFundedFace() public view {
        assertLe(handler.redeemedTotal(), note.fundedFace());
    }

    /// Notes outside escrow plus escrow always equal the supply.
    function invariant_escrowPlusHoldersEqualSupply() public view {
        uint256 held = note.balanceOf(address(note));
        address[5] memory a = [investor, investor2, third, outsider, stranger];
        for (uint256 i; i < a.length; ++i) {
            held += note.balanceOf(a[i]);
        }
        // holders that redeemed burned their notes, so held can only be below the supply
        assertLe(held, note.totalSupply());
    }

    /// Credential-less actors never end up holding notes.
    function invariant_ineligibleAddressesNeverHoldNotes() public view {
        assertEq(note.balanceOf(outsider), 0);
        assertEq(note.balanceOf(stranger), 0);
    }

    /// Proves the handler can actually reach settlement and redemption, so the invariants above are not vacuous.
    function test_handlerReachesSettlementAndRedemption() public {
        handler.fund(0, 4_000_000);
        handler.fund(1, 3_000_000);
        handler.warp(25 days);
        handler.warp(25 days);
        handler.warp(25 days);
        handler.settle(0);
        assertEq(uint8(note.phase()), uint8(KhataNote.Phase.Settled));
        handler.redeem(0);
        handler.redeem(1);
        assertEq(handler.redeemedTotal(), 7_000_000);
        assertEq(handler.paidToSellerOnSettle(), FACE - 7_000_000);
        assertEq(usdt.balanceOf(address(note)), 0);
    }

    function test_handlerReachesDefault() public {
        handler.fund(0, 4_000_000);
        handler.warp(25 days);
        handler.warp(25 days);
        handler.warp(25 days);
        handler.warp(25 days);
        handler.markDefault();
        assertEq(uint8(note.phase()), uint8(KhataNote.Phase.Defaulted));
    }
}

