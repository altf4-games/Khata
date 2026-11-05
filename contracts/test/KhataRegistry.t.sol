// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {KhataRegistry} from "../src/KhataRegistry.sol";
import {NicInvoice} from "../src/NicInvoice.sol";
import {NicJwt} from "../src/NicJwt.sol";
import {AttesterRegistry} from "../src/AttesterRegistry.sol";

contract KhataRegistryTest is Test {
    KhataRegistry internal reg;
    AttesterRegistry internal att;

    address internal owner = makeAddr("owner");
    /// The test contract is the registered seller wallet, so plain calls below are the seller's own.
    address internal seller = address(this);
    address internal rival = makeAddr("rival");

    string internal constant NIC_KID = "4DE1544AE695BDC84EC7BC12F2F57F813F44E301";
    string internal constant DEMO_KID = "DEMO-IRP-NOT-GOVERNMENT-1";
    bytes internal constant E = hex"010001";
    uint256 internal constant ATTESTER_PK = 0xA11CE;
    uint64 internal constant COOL_OFF = 1 days;
    bytes32 internal constant NIC_SELLER = keccak256("37ARZPT4384Q1MT");
    bytes32 internal constant DEMO_SELLER = keccak256("27DEMOS1234A1Z5");
    uint64 internal bindingVersion;

    bytes internal nicModulus;
    bytes internal demoModulus;
    string internal sample;
    bytes32 internal constant SAMPLE_IRN = 0xd9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17;

    event KeyAdded(bytes32 indexed kidHash, string kid, bool demo);
    event KeyRetired(bytes32 indexed kidHash, string kid);
    event InvoiceBound(
        bytes32 indexed nullifier, bytes32 indexed irn, bytes32 indexed kidHash, address binder, uint256 valuePaise
    );

    function setUp() public {
        vm.warp(1_800_000_000);
        att = new AttesterRegistry(owner);
        vm.prank(owner);
        att.addAttester(vm.addr(ATTESTER_PK));
        reg = new KhataRegistry(owner, att, COOL_OFF);
        _registerSeller(NIC_SELLER, seller);
        _registerSeller(DEMO_SELLER, seller);
        nicModulus = vm.parseBytes(vm.readFile("contracts/test/fixtures/nic-sample.modulus.hex"));
        demoModulus = vm.parseBytes(vm.readFile("contracts/test/fixtures/demo-irp/demo-irp.modulus.hex"));
        sample = vm.readFile("contracts/test/fixtures/nic-sample.token");
    }

    function _signedBinding(bytes32 gh, address wallet, uint64 until, uint64 version)
        internal
        view
        returns (AttesterRegistry.SellerBinding memory b, bytes memory sig)
    {
        b = AttesterRegistry.SellerBinding({gstinHash: gh, wallet: wallet, validUntil: until, version: version});
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_PK, att.sellerBindingDigest(b));
        sig = abi.encodePacked(r, s, v);
    }

    function _registerSeller(bytes32 gh, address wallet) internal {
        (AttesterRegistry.SellerBinding memory b, bytes memory sig) =
            _signedBinding(gh, wallet, uint64(block.timestamp + 365 days), ++bindingVersion);
        reg.registerSeller(b, sig);
    }

    function _demo(string memory name) internal view returns (string memory) {
        return vm.readFile(string.concat("contracts/test/fixtures/demo-irp/", name, ".token"));
    }

    function _addNic() internal {
        vm.prank(owner);
        reg.addKey(NIC_KID, nicModulus, E, false);
    }

    function _addDemo() internal {
        vm.prank(owner);
        reg.addKey(DEMO_KID, demoModulus, E, true);
    }

    // ---------- key registry ----------

    function test_ownerAddsKeyAndReadsItBack() public {
        vm.expectEmit(true, false, false, true);
        emit KeyAdded(keccak256(bytes(NIC_KID)), NIC_KID, false);
        _addNic();
        (bytes memory n, bytes memory e, bool active, bool demo) = reg.keyOf(NIC_KID);
        assertFalse(demo);
        assertEq(n, nicModulus);
        assertEq(e, E);
        assertTrue(active);
    }

    function test_onlyOwnerCanAddOrRetire() public {
        vm.prank(rival);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rival));
        reg.addKey(NIC_KID, nicModulus, E, false);

        _addNic();
        vm.prank(rival);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rival));
        reg.retireKey(NIC_KID);
    }

    function test_cannotAddSameKidTwice() public {
        _addNic();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.KeyAlreadyRegistered.selector, NIC_KID));
        reg.addKey(NIC_KID, nicModulus, E, false);
    }

    function test_rejectsShortOrEmptyKeyMaterial() public {
        vm.startPrank(owner);
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("K", new bytes(255), E, false); // under 2048 bits
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("K", nicModulus, "", false);
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("", nicModulus, E, false);
        vm.stopPrank();
    }

    /// Red team: exponent 1 let anyone forge a signature with no private key.
    function test_rejectsWeakOrMalformedExponents() public {
        vm.startPrank(owner);
        bytes[6] memory bad = [bytes(hex"01"), hex"03", hex"010000", hex"00010001", hex"0100010001", hex"010002"];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(KhataRegistry.InvalidKey.selector);
            reg.addKey("K", nicModulus, bad[i], false);
        }
        // a larger odd exponent is fine
        reg.addKey("K3", nicModulus, hex"010003", false);
        vm.stopPrank();
    }

    /// Red team: an even modulus, or one with a leading zero byte, is not a usable RSA key.
    function test_rejectsEvenOrPaddedModulus() public {
        bytes memory even = nicModulus;
        even[even.length - 1] = 0x00;
        bytes memory padded = bytes.concat(hex"00", nicModulus);
        bytes memory zeroTop = nicModulus;
        zeroTop[0] = 0x00;
        vm.startPrank(owner);
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("EVEN", even, E, false);
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("PAD", padded, E, false);
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("TOP0", zeroTop, E, false);
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("LEN300", new bytes(300), E, false);
        vm.stopPrank();
    }

    function test_unknownKeyReadReverts() public {
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.UnknownKey.selector, "nope"));
        reg.keyOf("nope");
    }

    function test_retireUnknownKeyReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.UnknownKey.selector, "nope"));
        reg.retireKey("nope");
    }

    // ---------- binding ----------

    function test_bindsNicSampleAndStoresIt() public {
        _addNic();
        bytes32 nul = NicInvoice.nullifierOf(SAMPLE_IRN);

        vm.expectEmit(true, true, true, true);
        emit InvoiceBound(nul, SAMPLE_IRN, keccak256(bytes(NIC_KID)), seller, 200);
        vm.prank(seller);
        bytes32 got = reg.bindInvoice(sample);

        assertEq(got, nul);
        assertTrue(reg.isBound(nul));
        (address binder, uint64 at, uint128 value, bytes32 irn,,) = reg.bindings(nul);
        assertEq(binder, seller);
        assertEq(at, uint64(block.timestamp));
        assertEq(value, 200);
        assertEq(irn, SAMPLE_IRN);
    }

    /// The signature check alone is not enough: a second financing of the same invoice must revert.
    function test_secondBindOfSameIrnReverts() public {
        _addNic();
        vm.prank(seller);
        reg.bindInvoice(sample);

        bytes32 nul = NicInvoice.nullifierOf(SAMPLE_IRN);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.IrnAlreadyFinanced.selector, nul));
        reg.bindInvoice(sample);
    }

    function test_alreadyFinancedHasReadableName() public pure {
        // The custom error name is what wallets and the UI show: "IrnAlreadyFinanced".
        assertEq(KhataRegistry.IrnAlreadyFinanced.selector, bytes4(keccak256("IrnAlreadyFinanced(bytes32)")));
    }

    /// Same IRN, different token bytes and a fresh signature: still one financing per invoice.
    function test_sameIrnInDifferentlySignedTokenIsBlocked() public {
        _addDemo();
        vm.prank(seller);
        bytes32 nul = reg.bindInvoice(_demo("demo-01"));
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.IrnAlreadyFinanced.selector, nul));
        reg.bindInvoice(_demo("demo-dup-irn"));
    }

    function test_differentInvoicesBindIndependently() public {
        _addDemo();
        reg.bindInvoice(_demo("demo-01"));
        reg.bindInvoice(_demo("demo-02"));
        reg.bindInvoice(_demo("demo-no-irndt"));
    }

    function test_tamperedTokenDoesNotBind() public {
        _addNic();
        bytes memory t = bytes(sample);
        uint256 pos = _firstDot(t) + 40; // inside the payload part
        t[pos] = t[pos] == "A" ? bytes1("B") : bytes1("A");
        vm.expectRevert(KhataRegistry.InvalidSignature.selector);
        reg.bindInvoice(string(t));
        assertFalse(reg.isBound(NicInvoice.nullifierOf(SAMPLE_IRN)));
    }

    function test_unknownKidReverts() public {
        _addNic();
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.UnknownKey.selector, "DEMO-IRP-UNREGISTERED"));
        reg.bindInvoice(_demo("demo-unknown-kid"));
    }

    /// A key registered under the wrong kid cannot validate a token that names another kid.
    function test_keyUnderWrongKidFailsSignature() public {
        vm.prank(owner);
        reg.addKey(NIC_KID, demoModulus, E, false); // demo modulus registered under the NIC kid
        vm.expectRevert(KhataRegistry.InvalidSignature.selector);
        reg.bindInvoice(sample);
    }

    function test_retiredKeyCannotBindNewInvoices() public {
        _addDemo();
        reg.bindInvoice(_demo("demo-01"));

        vm.expectEmit(true, false, false, true);
        emit KeyRetired(keccak256(bytes(DEMO_KID)), DEMO_KID);
        vm.prank(owner);
        reg.retireKey(DEMO_KID);

        (,, bool active, bool demo) = reg.keyOf(DEMO_KID);
        assertTrue(demo);
        assertFalse(active);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.KeyIsRetired.selector, DEMO_KID));
        reg.bindInvoice(_demo("demo-02"));
        // the earlier binding survives retirement
        assertTrue(reg.isBound(NicInvoice.demoNullifierOf(_irnOf("demo-01"))));
    }

    function test_creditNoteIsRefused() public {
        _addDemo();
        vm.expectRevert(abi.encodeWithSelector(NicInvoice.InvalidField.selector, "DocTyp"));
        reg.bindInvoice(_demo("demo-credit-note"));
    }

    // ---------- inspect (read-only, for the verification panel) ----------

    function test_inspectReportsEverythingTheUiShows() public {
        _addNic();
        KhataRegistry.Inspection memory r = reg.inspect(sample);
        assertEq(r.kid, NIC_KID);
        assertTrue(r.keyRegistered);
        assertTrue(r.keyActive);
        assertTrue(r.signatureValid);
        assertFalse(r.alreadyBound);
        assertEq(r.invoice.docNo, "Test-00df1");
        assertEq(r.invoice.valuePaise, 200);
        assertEq(r.nullifier, NicInvoice.nullifierOf(SAMPLE_IRN));

        vm.prank(seller);
        reg.bindInvoice(sample);
        assertTrue(reg.inspect(sample).alreadyBound);
    }

    /// The panel must be able to say "signature invalid" for every changed payload byte, never a parse error.
    function test_inspectOnTamperedPayloadAlwaysSaysSignatureInvalid() public {
        _addNic();
        bytes memory orig = bytes(sample);
        uint256 start = _firstDot(orig) + 1;
        for (uint256 i = start; i < start + 120; i += 7) {
            bytes memory t = bytes(sample);
            t[i] = t[i] == "A" ? bytes1("B") : bytes1("A");
            KhataRegistry.Inspection memory r = reg.inspect(string(t));
            assertFalse(r.signatureValid, "changed byte must not verify");
            assertTrue(r.keyRegistered);
            assertEq(bytes(r.invoice.docNo).length, 0, "unverified data must not be shown");
            assertFalse(r.alreadyBound);
        }
    }

    function test_inspectUnknownKidReportsNotRegistered() public {
        _addNic();
        KhataRegistry.Inspection memory r = reg.inspect(_demo("demo-unknown-kid"));
        assertFalse(r.keyRegistered);
        assertFalse(r.signatureValid);
        assertEq(r.kid, "DEMO-IRP-UNREGISTERED");
    }

    // ---------- gas ----------

    function test_gasReport() public {
        _addNic();
        uint256 g = gasleft();
        reg.inspect(sample);
        console.log("inspect (verify+parse) gas", g - gasleft());

        g = gasleft();
        vm.prank(seller);
        reg.bindInvoice(sample);
        console.log("bindInvoice (verify+parse+bind) gas", g - gasleft());
    }

    function test_gasBreakdown() public view {
        uint256 g = gasleft();
        NicJwt.Parts memory p = NicJwt.split(sample);
        console.log("split (decode base64 x3) gas", g - gasleft());
        g = gasleft();
        bool ok = NicJwt.verifySignature(p, E, nicModulus);
        console.log("RSA verify gas", g - gasleft());
        assertTrue(ok);
        g = gasleft();
        NicInvoice.parse(p.payload);
        console.log("parse payload gas", g - gasleft());
    }

    function _firstDot(bytes memory b) internal pure returns (uint256) {
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == ".") return i;
        }
        revert("no dot");
    }

    function _irnOf(string memory name) internal view returns (bytes32) {
        return reg.inspect(_demo(name)).invoice.irn;
    }

    // ---------- red team regressions ----------

    /// Red team: a demo-key token carrying a real IRN burned the real invoice's nullifier.
    /// Demo-key invoices now live in their own namespace.
    function test_demoKeyCannotBurnARealIrn() public {
        _addNic();
        _addDemo();
        string memory forged = vm.readFile("contracts/test/fixtures/redteam/collide-nic-irn.token");
        bytes32 demoNul = reg.bindInvoice(forged);
        assertTrue(demoNul != NicInvoice.nullifierOf(SAMPLE_IRN), "demo namespace differs");

        vm.prank(seller);
        bytes32 realNul = reg.bindInvoice(sample); // the genuine NIC token still binds
        assertEq(realNul, NicInvoice.nullifierOf(SAMPLE_IRN));
        (address binder,,,,,) = reg.bindings(realNul);
        assertEq(binder, seller);
    }

    function test_demoNamespaceStillBlocksDuplicatesInsideItself() public {
        _addDemo();
        bytes32 n = reg.bindInvoice(_demo("demo-01"));
        assertEq(n, NicInvoice.demoNullifierOf(_irnOf("demo-01")));
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.IrnAlreadyFinanced.selector, n));
        reg.bindInvoice(_demo("demo-dup-irn"));
    }

    function test_inspectFlagsDemoKeys() public {
        _addNic();
        _addDemo();
        assertFalse(reg.inspect(sample).keyIsDemo);
        KhataRegistry.Inspection memory r = reg.inspect(_demo("demo-01"));
        assertTrue(r.keyIsDemo);
        assertEq(r.nullifier, NicInvoice.demoNullifierOf(r.invoice.irn));
    }

    /// Red team: after renouncing, a compromised key could never be retired.
    function test_ownershipCannotBeRenounced() public {
        vm.prank(owner);
        vm.expectRevert(KhataRegistry.OwnershipCannotBeRenounced.selector);
        reg.renounceOwnership();
        assertEq(reg.owner(), owner);
    }

    function test_ownershipTransfersInTwoSteps() public {
        address next = makeAddr("next");
        vm.prank(owner);
        reg.transferOwnership(next);
        assertEq(reg.owner(), owner, "not yet transferred");
        vm.prank(next);
        reg.acceptOwnership();
        assertEq(reg.owner(), next);
    }

    // ---------- seller wallets: QR squatting ----------

    /// Whoever holds a copy of the QR must not be able to register it first.
    function test_aQrHolderWhoIsNotTheSellerWalletCannotBind() public {
        _addNic();
        vm.prank(rival);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.NotSellerWallet.selector, seller));
        reg.bindInvoice(sample);
        assertFalse(reg.isBound(NicInvoice.nullifierOf(SAMPLE_IRN)));

        reg.bindInvoice(sample); // the real seller still can
        assertTrue(reg.isBound(NicInvoice.nullifierOf(SAMPLE_IRN)));
    }

    function test_unregisteredSellerGstinCannotBind() public {
        KhataRegistry fresh = new KhataRegistry(owner, att, COOL_OFF);
        vm.prank(owner);
        fresh.addKey(NIC_KID, nicModulus, E, false);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.SellerNotRegistered.selector, NIC_SELLER));
        fresh.bindInvoice(sample);
    }

    function test_sellerRegistrationNeedsAnAcceptedAttester() public {
        uint256 roguePk = 0xBAD;
        AttesterRegistry.SellerBinding memory b = AttesterRegistry.SellerBinding({
            gstinHash: keccak256("29NEWSELLER1Z5"),
            wallet: rival,
            validUntil: uint64(block.timestamp + 1 days),
            version: 1
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(roguePk, att.sellerBindingDigest(b));
        vm.expectRevert(abi.encodeWithSelector(AttesterRegistry.UnknownAttester.selector, vm.addr(roguePk)));
        reg.registerSeller(b, abi.encodePacked(r, s, v));
    }

    function test_sellerBindingCannotBeReplayedOrDowngraded() public {
        // version 1 and 2 were used in setUp for the two GSTINs; a new GSTIN has its own counter
        (AttesterRegistry.SellerBinding memory b1, bytes memory sig1) =
            _signedBinding(NIC_SELLER, rival, uint64(block.timestamp + 365 days), 5);
        reg.registerSeller(b1, sig1);
        (address wallet,, uint64 version) = reg.sellers(NIC_SELLER);
        assertEq(wallet, rival);
        assertEq(version, 5);

        // an older, still-valid binding for the previous wallet cannot be replayed
        (AttesterRegistry.SellerBinding memory old, bytes memory oldSig) =
            _signedBinding(NIC_SELLER, seller, uint64(block.timestamp + 365 days), 4);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.StaleBinding.selector, 5));
        reg.registerSeller(old, oldSig);
        // the same version cannot be registered twice either
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.StaleBinding.selector, 5));
        reg.registerSeller(b1, sig1);
    }

    function test_movingASellerWalletRemovesTheOldWalletsRights() public {
        _addNic();
        (AttesterRegistry.SellerBinding memory b, bytes memory sig) =
            _signedBinding(NIC_SELLER, rival, uint64(block.timestamp + 365 days), 9);
        reg.registerSeller(b, sig);

        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.NotSellerWallet.selector, rival));
        reg.bindInvoice(sample); // the old wallet is no longer the seller
        vm.prank(rival);
        reg.bindInvoice(sample);
    }

    function test_expiredSellerBindingCannotBind() public {
        _addNic();
        vm.warp(block.timestamp + 366 days);
        vm.expectRevert(); // key + sample are fine, the seller binding has expired
        reg.bindInvoice(sample);
    }

    function test_sellerBindingRejectsZeroWallet() public {
        (AttesterRegistry.SellerBinding memory b, bytes memory sig) =
            _signedBinding(NIC_SELLER, address(0), uint64(block.timestamp + 1 days), 77);
        vm.expectRevert(KhataRegistry.InvalidWallet.selector);
        reg.registerSeller(b, sig);
    }

    function test_inspectShowsTheSellerWallet() public {
        _addNic();
        assertEq(reg.inspect(sample).sellerWallet, seller);
    }

    // ---------- cool-off ----------

    /// An IRN can be cancelled within 24 hours and the signature still verifies, so funding waits.
    function test_fundableAtIsBindTimePlusCoolOff() public {
        _addNic();
        bytes32 nul = reg.bindInvoice(sample);
        (, uint64 at,,, uint64 fundableAt, bytes32 gh) = reg.bindings(nul);
        assertEq(fundableAt, at + COOL_OFF);
        assertEq(gh, NIC_SELLER);
        assertEq(reg.coolOff(), COOL_OFF);
    }
}

