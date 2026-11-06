// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {AttesterRegistry} from "./AttesterRegistry.sol";
import {KhataRegistry} from "./KhataRegistry.sol";
import {KhataNote} from "./KhataNote.sol";

/// @notice Creates one note per bound invoice. Only the wallet that bound the invoice may create its note.
/// @dev The invoice value is in rupees, the note is in USDT. `microUsdtPerPaise` is a fixed rate chosen when the
///      factory is deployed. It is a demo constant, not a price feed.
contract KhataFactory {
    error InvoiceNotBound(bytes32 nullifier);
    error NotBinder(address binder);
    error NoteExists(address note);
    error InvalidTerms();
    error NotCurrentSellerWallet(address current);

    struct Terms {
        uint64 dueDate; // when the debtor owes the face value (payment terms are the seller's, not in the QR)
        uint64 fundingDeadline;
        uint64 graceSeconds;
        uint32 discountBps; // investors pay (10000 - discountBps) / 10000 of face value
        uint8 minTier; // lowest credential tier allowed to hold the note
    }

    uint32 public constant MAX_DISCOUNT_BPS = 5000;
    uint64 public constant MAX_GRACE = 90 days;
    /// Invoice finance is short-dated; a due date beyond this could never be reached, and its default time could overflow.
    uint64 public constant MAX_TENOR = 365 days;

    IERC20 public immutable usdt;
    KhataRegistry public immutable registry;
    AttesterRegistry public immutable attesters;
    uint256 public immutable microUsdtPerPaise;

    mapping(bytes32 nullifier => address) public noteOf;

    event NoteCreated(
        bytes32 indexed nullifier, address indexed note, address indexed seller, uint256 faceValue, uint64 dueDate
    );

    constructor(IERC20 usdt_, KhataRegistry registry_, AttesterRegistry attesters_, uint256 microUsdtPerPaise_) {
        usdt = usdt_;
        registry = registry_;
        attesters = attesters_;
        microUsdtPerPaise = microUsdtPerPaise_;
    }

    function createNote(bytes32 nullifier, Terms calldata t) external returns (address) {
        (address binder,, uint128 valuePaise,, uint64 fundableAt, bytes32 gstinHash) = registry.bindings(nullifier);
        if (binder == address(0)) revert InvoiceNotBound(nullifier);
        if (msg.sender != binder) revert NotBinder(binder);
        _requireCurrentSeller(binder, gstinHash);
        address existing = noteOf[nullifier];
        if (existing != address(0)) revert NoteExists(existing);

        if (
            t.discountBps > MAX_DISCOUNT_BPS || t.graceSeconds > MAX_GRACE || t.dueDate <= fundableAt
                || t.fundingDeadline <= fundableAt || t.fundingDeadline > t.dueDate
                || t.dueDate > block.timestamp + MAX_TENOR
        ) revert InvalidTerms();

        uint256 face = uint256(valuePaise) * microUsdtPerPaise;
        if (face == 0) revert InvalidTerms();

        KhataNote note = new KhataNote(
            KhataNote.Config({
                usdt: usdt,
                attesters: attesters,
                seller: binder,
                faceValue: face,
                fundableAt: fundableAt,
                fundingDeadline: t.fundingDeadline,
                dueDate: t.dueDate,
                graceSeconds: t.graceSeconds,
                discountBps: t.discountBps,
                minTier: t.minTier,
                nullifier: nullifier
            }),
            string.concat("Khata note ", Strings.toHexString(uint256(nullifier) >> 224, 4))
        );
        noteOf[nullifier] = address(note);
        emit NoteCreated(nullifier, address(note), binder, face, t.dueDate);
        return address(note);
    }

    /// The binder must still be the seller's authorised wallet: if the attester moved the GSTIN to a new wallet (a lost
    /// key), or the binding lapsed, the old wallet must not raise money on invoices it bound earlier.
    function _requireCurrentSeller(address binder, bytes32 gstinHash) private view {
        (address current, uint64 validUntil,, address attester) = registry.sellers(gstinHash);
        if (current != binder || validUntil <= block.timestamp || !attesters.isAttester(attester)) {
            revert NotCurrentSellerWallet(current);
        }
    }
}
