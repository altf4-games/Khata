// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AttesterRegistry} from "./AttesterRegistry.sol";

/// @notice One financed invoice. 1 note unit = 1 unit (1e-6) of USDT of face value.
/// @dev Life of a note:
///      1. All notes start in escrow inside this contract.
///      2. After the cool-off, investors with a valid credential `fund`: USDT goes straight to the seller and
///         the notes come out of escrow in the same transaction (delivery versus payment).
///      3. Notes move only between holders whose attester-signed credential is valid at that moment, and stop
///         moving at maturity.
///      4. On or after the due date anyone may `settle` by paying the full face value. Unsold notes are burned
///         and the seller keeps that part of the payment; holders `redeem` 1:1.
///      5. Past due date plus grace, anyone may `markDefault`. Default is final.
contract KhataNote is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Phase {
        Funding,
        Settled,
        Defaulted
    }

    error WrongPhase(Phase phase);
    error CoolOffActive(uint64 fundableAt);
    error FundingClosed();
    error FundingEnded(uint64 deadline);
    error ZeroAmount();
    error ExceedsAvailable(uint256 available);
    error ReceiverNotEligible(address receiver, AttesterRegistry.Reason reason);
    error ReceiverTierTooLow(address receiver, uint8 tier, uint8 required);
    error ReceiverIsNote();
    error TransferAfterMaturity(uint64 dueDate);
    error NotYetDue(uint64 dueDate);
    error NotInDefault(uint64 defaultableAt);
    error NothingToRedeem();
    error NotSellerOrFundingOpen();

    struct Config {
        IERC20 usdt;
        AttesterRegistry attesters;
        address seller;
        uint256 faceValue;
        uint64 fundableAt;
        uint64 fundingDeadline;
        uint64 dueDate;
        uint64 graceSeconds;
        uint32 discountBps;
        uint8 minTier;
        bytes32 nullifier;
    }

    event Funded(address indexed investor, uint256 amount, uint256 price);
    event FundingClosedEarly(uint256 burnedUnsold);
    event Settled(address indexed payer, uint256 faceValue, uint256 paidToSeller);
    event Redeemed(address indexed holder, uint256 amount);
    event DefaultMarked(uint256 outstanding);

    IERC20 public immutable usdt;
    AttesterRegistry public immutable attesters;
    address public immutable seller;
    uint256 public immutable faceValue;
    uint64 public immutable fundableAt;
    uint64 public immutable fundingDeadline;
    uint64 public immutable dueDate;
    uint64 public immutable graceSeconds;
    uint32 public immutable discountBps;
    uint8 public immutable minTier;
    bytes32 public immutable nullifier;

    Phase public phase;
    bool public fundingClosed;
    uint256 public fundedFace;

    constructor(Config memory c, string memory name_) ERC20(name_, "KHATA") {
        usdt = c.usdt;
        attesters = c.attesters;
        seller = c.seller;
        faceValue = c.faceValue;
        fundableAt = c.fundableAt;
        fundingDeadline = c.fundingDeadline;
        dueDate = c.dueDate;
        graceSeconds = c.graceSeconds;
        discountBps = c.discountBps;
        minTier = c.minTier;
        nullifier = c.nullifier;
        _mint(address(this), c.faceValue);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ---------- funding ----------

    /// @notice USDT an investor pays for `amount` notes, rounded up so nobody gets notes for free.
    function quote(uint256 amount) public view returns (uint256) {
        return Math.mulDiv(amount, 10_000 - discountBps, 10_000, Math.Rounding.Ceil);
    }

    /// @notice Buys `amount` notes from escrow. The investor must have approved the price to this contract.
    function fund(uint256 amount) external nonReentrant {
        _fund(amount);
    }

    /// @notice Same as `fund`, with an EIP-2612 permit so no separate approval transaction is needed.
    function fundWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant {
        // A front-runner may have used the permit already; the allowance is then in place and funding still works.
        try IERC20Permit(address(usdt)).permit(msg.sender, address(this), quote(amount), deadline, v, r, s) {} catch {}
        _fund(amount);
    }

    function _fund(uint256 amount) private {
        if (phase != Phase.Funding) revert WrongPhase(phase);
        if (fundingClosed) revert FundingClosed();
        if (block.timestamp < fundableAt) revert CoolOffActive(fundableAt);
        if (block.timestamp > fundingDeadline) revert FundingEnded(fundingDeadline);
        if (amount == 0) revert ZeroAmount();
        uint256 available = balanceOf(address(this));
        if (amount > available) revert ExceedsAvailable(available);
        _requireEligible(msg.sender);

        uint256 price = quote(amount);
        usdt.safeTransferFrom(msg.sender, seller, price);
        _transfer(address(this), msg.sender, amount);
        fundedFace += amount;
        emit Funded(msg.sender, amount, price);
    }

    /// @notice Burns the notes nobody bought. The seller may do this at any time; anyone after the funding deadline.
    function closeFunding() external {
        if (phase != Phase.Funding) revert WrongPhase(phase);
        if (fundingClosed) revert FundingClosed();
        if (msg.sender != seller && block.timestamp <= fundingDeadline) revert NotSellerOrFundingOpen();
        _closeFunding();
    }

    function _closeFunding() private {
        fundingClosed = true;
        uint256 unsold = balanceOf(address(this));
        if (unsold > 0) _burn(address(this), unsold);
        emit FundingClosedEarly(unsold);
    }

    // ---------- settlement ----------

    /// @notice Pays the full face value. Anyone may pay on the debtor's behalf. Not before the due date.
    function settle() external nonReentrant {
        if (phase != Phase.Funding) revert WrongPhase(phase);
        if (block.timestamp < dueDate) revert NotYetDue(dueDate);
        if (!fundingClosed) _closeFunding();

        usdt.safeTransferFrom(msg.sender, address(this), faceValue);
        phase = Phase.Settled;

        // Holders of the funded notes are paid on redemption; the unsold part of the face value is the seller's.
        uint256 toSeller = faceValue - totalSupply();
        if (toSeller > 0) usdt.safeTransfer(seller, toSeller);
        emit Settled(msg.sender, faceValue, toSeller);
    }

    /// @notice Burns the caller's notes and pays out their face value. Needs no credential.
    function redeem() external nonReentrant {
        if (phase != Phase.Settled) revert WrongPhase(phase);
        uint256 amount = balanceOf(msg.sender);
        if (amount == 0) revert NothingToRedeem();
        _burn(msg.sender, amount);
        usdt.safeTransfer(msg.sender, amount);
        emit Redeemed(msg.sender, amount);
    }

    /// @notice After due date plus grace without settlement. Final: nothing is paid and nothing moves.
    function markDefault() external {
        if (phase != Phase.Funding) revert WrongPhase(phase);
        uint64 defaultableAt = dueDate + graceSeconds + 1;
        if (block.timestamp < defaultableAt) revert NotInDefault(defaultableAt);
        if (!fundingClosed) _closeFunding();
        phase = Phase.Defaulted;
        emit DefaultMarked(totalSupply());
    }

    // ---------- transfer rules ----------

    /// @dev Mints and burns are not transfers. Every holder-to-holder move, including `transferFrom`, is checked.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) _checkTransfer(to);
        super._update(from, to, value);
    }

    function _checkTransfer(address to) private view {
        if (to == address(this)) revert ReceiverIsNote();
        if (block.timestamp >= dueDate) revert TransferAfterMaturity(dueDate);
        _requireEligible(to);
    }

    function _requireEligible(address who) private view {
        (AttesterRegistry.Reason reason, uint8 tier) = attesters.eligibility(who);
        if (reason != AttesterRegistry.Reason.Eligible) revert ReceiverNotEligible(who, reason);
        if (tier < minTier) revert ReceiverTierTooLow(who, tier, minTier);
    }

    /// @notice Whether a transfer would go through right now, and if not, a sentence a person can read.
    function explainTransfer(address, address to, uint256) external view returns (bool, string memory) {
        if (to == address(0)) return (false, "Notes cannot be sent to the zero address.");
        if (to == address(this)) return (false, "Notes cannot be sent to the note contract itself.");
        if (block.timestamp >= dueDate) return (false, "Transfers stop at maturity.");
        (AttesterRegistry.Reason reason, uint8 tier) = attesters.eligibility(to);
        if (reason == AttesterRegistry.Reason.NoCredential) {
            return (false, "The receiver has no credential from an accepted attester.");
        }
        if (reason == AttesterRegistry.Reason.Expired) return (false, "The receiver's credential has expired.");
        if (reason == AttesterRegistry.Reason.Revoked) {
            return (false, "The receiver's credential was revoked by its attester.");
        }
        if (reason == AttesterRegistry.Reason.AttesterRemoved) {
            return (false, "The attester that issued the receiver's credential is no longer trusted.");
        }
        if (tier < minTier) return (false, "The receiver's credential tier is below the minimum for this note.");
        return (true, "Allowed.");
    }
}
