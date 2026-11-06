// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {KhataRegistry} from "../src/KhataRegistry.sol";
import {AttesterRegistry} from "../src/AttesterRegistry.sol";
import {HonkVerifier} from "../src/zk/HonkVerifier.sol";

/// The zero-knowledge binding path, against real proofs made by the Noir circuit (zk/khata_zk) with Barretenberg.
/// Fixtures: contracts/test/fixtures/zk/*.proof and *.inputs (the proof binds the address of `zkSeller`).
contract KhataZkTest is Test {
    KhataRegistry internal reg;
    AttesterRegistry internal att;
    HonkVerifier internal verifier;

    address internal owner = makeAddr("owner");
    /// The wallet the fixture proofs name as their owner.
    address internal zkSeller = 0xDFa97bfe5d2b2E8169b194eAA78Fbb793346B174;
    address internal rival = makeAddr("rival");

    string internal constant NIC_KID = "4DE1544AE695BDC84EC7BC12F2F57F813F44E301";
    string internal constant DEMO_KID = "DEMO-IRP-NOT-GOVERNMENT-1";
    bytes internal constant E = hex"010001";
    uint256 internal constant ATTESTER_PK = 0xA11CE;
    bytes32 internal constant NIC_SELLER = keccak256("37ARZPT4384Q1MT");
    bytes32 internal constant DEMO_SELLER = keccak256("27DEMOS1234A1Z5");
    bytes32 internal constant SAMPLE_NULLIFIER = 0x1cf2ba400656c20ef1eea061518975068eb93aae07cdbbfadf5065ff46f69251;
    uint64 internal version;

    function setUp() public {
        vm.warp(1_800_000_000);
        att = new AttesterRegistry(owner);
        vm.prank(owner);
        att.addAttester(vm.addr(ATTESTER_PK));
        reg = new KhataRegistry(owner, att, 1 days);
        verifier = new HonkVerifier();
        bytes memory nic = vm.parseBytes(vm.readFile("contracts/test/fixtures/nic-sample.modulus.hex"));
        bytes memory demo = vm.parseBytes(vm.readFile("contracts/test/fixtures/demo-irp/demo-irp.modulus.hex"));
        vm.startPrank(owner);
        reg.addKey(NIC_KID, nic, E, false);
        reg.addKey(DEMO_KID, demo, E, true);
        reg.setZkVerifier(address(verifier));
        vm.stopPrank();
        _bindSeller(NIC_SELLER, zkSeller);
        _bindSeller(DEMO_SELLER, zkSeller);
    }

    function _bindSeller(bytes32 gh, address wallet) internal {
        AttesterRegistry.SellerBinding memory b = AttesterRegistry.SellerBinding({
            gstinHash: gh, wallet: wallet, validUntil: uint64(block.timestamp + 365 days), version: ++version
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTER_PK, att.sellerBindingDigest(b));
        reg.registerSeller(b, abi.encodePacked(r, s, v));
    }

    function _proof(string memory name) internal view returns (bytes memory) {
        return vm.readFileBinary(string.concat("contracts/test/fixtures/zk/", name, ".proof"));
    }

    function _inputs(string memory name) internal view returns (bytes32[] memory out) {
        bytes memory raw = vm.readFileBinary(string.concat("contracts/test/fixtures/zk/", name, ".inputs"));
        out = new bytes32[](raw.length / 32);
        for (uint256 i; i < out.length; ++i) {
            bytes32 w;
            assembly {
                w := mload(add(add(raw, 32), mul(i, 32)))
            }
            out[i] = w;
        }
    }

    function test_aProofBindsTheNicSampleWithoutRevealingTheIrn() public {
        vm.prank(zkSeller);
        uint256 g = gasleft();
        bytes32 n = reg.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
        console.log("bindInvoiceZk gas", g - gasleft());
        assertEq(n, SAMPLE_NULLIFIER, "the same nullifier the plain path would give");
        (address binder,, uint128 paise, bytes32 irn,, bytes32 gstinHash) = reg.bindings(n);
        assertEq(binder, zkSeller);
        assertEq(paise, 200);
        assertEq(irn, bytes32(0), "the IRN stays hidden");
        assertEq(gstinHash, NIC_SELLER);
    }

    function test_aDemoKeyProofUsesTheDemoNamespace() public {
        vm.prank(zkSeller);
        bytes32 n = reg.bindInvoiceZk(_proof("demo-01"), _inputs("demo-01"));
        assertTrue(n != SAMPLE_NULLIFIER);
        assertTrue(reg.isBound(n));
    }

    function test_theSameInvoiceCannotBeBoundTwiceByProof() public {
        vm.startPrank(zkSeller);
        reg.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.IrnAlreadyFinanced.selector, SAMPLE_NULLIFIER));
        reg.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
        vm.stopPrank();
    }

    function test_aProofAfterThePlainPathIsRefused_andTheOtherWayRound() public {
        string memory token = vm.readFile("contracts/test/fixtures/nic-sample.token");
        vm.prank(zkSeller);
        reg.bindInvoice(token);
        vm.prank(zkSeller);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.IrnAlreadyFinanced.selector, SAMPLE_NULLIFIER));
        reg.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
    }

    function test_thePlainPathAfterAProofIsRefused() public {
        vm.prank(zkSeller);
        reg.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
        string memory token = vm.readFile("contracts/test/fixtures/nic-sample.token");
        vm.prank(zkSeller);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.IrnAlreadyFinanced.selector, SAMPLE_NULLIFIER));
        reg.bindInvoice(token);
    }

    function test_aProofCannotBeReplayedByAnotherWallet() public {
        vm.prank(rival);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.ProofNotForCaller.selector, zkSeller));
        reg.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
    }

    function test_aChangedPublicInputIsRefusedByTheVerifier() public {
        bytes32[] memory inputs = _inputs("nic-sample");
        inputs[24] = bytes32(uint256(2_000_000)); // claim a larger value
        vm.prank(zkSeller);
        vm.expectRevert();
        reg.bindInvoiceZk(_proof("nic-sample"), inputs);
    }

    function test_aChangedProofByteIsRefused() public {
        bytes memory p = _proof("nic-sample");
        p[100] = bytes1(uint8(p[100]) ^ 1);
        vm.prank(zkSeller);
        vm.expectRevert();
        reg.bindInvoiceZk(p, _inputs("nic-sample"));
    }

    function test_aModulusThatIsNotARegisteredKeyIsRefused() public {
        bytes32[] memory inputs = _inputs("nic-sample");
        inputs[0] = bytes32(uint256(inputs[0]) ^ 1);
        vm.prank(zkSeller);
        vm.expectRevert(KhataRegistry.UnknownZkKey.selector);
        reg.bindInvoiceZk(_proof("nic-sample"), inputs);
    }

    function test_aNonCanonicalLimbIsRefused() public {
        bytes32[] memory inputs = _inputs("nic-sample");
        inputs[0] = bytes32(uint256(inputs[0]) + (uint256(1) << 120)); // the same number written with an oversized limb
        vm.prank(zkSeller);
        vm.expectRevert(KhataRegistry.UnknownZkKey.selector);
        reg.bindInvoiceZk(_proof("nic-sample"), inputs);
    }

    function test_theDemoFlagMustMatchTheKey() public {
        bytes32[] memory inputs = _inputs("nic-sample");
        inputs[19] = bytes32(uint256(1)); // claim the government key is a demo key
        vm.prank(zkSeller);
        vm.expectRevert(KhataRegistry.DemoFlagMismatch.selector);
        reg.bindInvoiceZk(_proof("nic-sample"), inputs);
    }

    function test_aRetiredKeyCannotBindByProof() public {
        vm.prank(owner);
        reg.retireKey(NIC_KID);
        vm.prank(zkSeller);
        vm.expectRevert(KhataRegistry.ZkKeyRetired.selector);
        reg.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
    }

    function test_theSellerRulesApplyToProofsToo() public {
        // a seller GSTIN with no wallet binding cannot bind, with or without a proof
        KhataRegistry fresh = new KhataRegistry(owner, att, 1 days);
        vm.startPrank(owner);
        fresh.addKey(NIC_KID, vm.parseBytes(vm.readFile("contracts/test/fixtures/nic-sample.modulus.hex")), E, false);
        fresh.setZkVerifier(address(verifier));
        vm.stopPrank();
        vm.prank(zkSeller);
        vm.expectRevert(abi.encodeWithSelector(KhataRegistry.SellerNotRegistered.selector, NIC_SELLER));
        fresh.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
    }

    function test_withoutAVerifierProofsAreRefused() public {
        KhataRegistry fresh = new KhataRegistry(owner, att, 1 days);
        vm.prank(zkSeller);
        vm.expectRevert(KhataRegistry.ZkNotEnabled.selector);
        fresh.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
    }

    event ZkVerifierSet(address indexed previous, address indexed verifier);

    function test_changingTheVerifierIsAnnounced() public {
        vm.expectEmit(true, true, false, false);
        emit ZkVerifierSet(address(verifier), address(0xBEEF));
        vm.prank(owner);
        reg.setZkVerifier(address(0xBEEF));
    }

    function test_addingTheSameModulusUnderAnotherKidIsRefused() public {
        bytes memory nic = vm.parseBytes(vm.readFile("contracts/test/fixtures/nic-sample.modulus.hex"));
        vm.prank(owner);
        vm.expectRevert(KhataRegistry.ModulusAlreadyRegistered.selector);
        reg.addKey("ANOTHER-KID", nic, E, true);
        // the proof still binds: the first registration was not overwritten
        vm.prank(zkSeller);
        reg.bindInvoiceZk(_proof("nic-sample"), _inputs("nic-sample"));
    }

    /// Front-running defence: a rival who is the attested seller for the same GSTIN cannot swap the proof's owner input to
    /// themselves, because the owner is a public input the proof is bound to.
    function test_aRivalCannotRewriteTheOwnerInputOfSomeoneElsesProof() public {
        _bindSeller(NIC_SELLER, rival);
        bytes32[] memory inputs = _inputs("nic-sample");
        inputs[18] = bytes32(uint256(uint160(rival)));
        bytes memory proof = _proof("nic-sample");
        vm.prank(rival);
        vm.expectRevert();
        reg.bindInvoiceZk(proof, inputs);
        assertFalse(reg.isBound(SAMPLE_NULLIFIER));
    }

    function test_onlyTheOwnerSetsTheVerifier() public {
        vm.prank(rival);
        vm.expectRevert();
        reg.setZkVerifier(address(1));
    }

    function test_theWrongNumberOfPublicInputsIsRefused() public {
        bytes32[] memory inputs = new bytes32[](3);
        vm.prank(zkSeller);
        vm.expectRevert(KhataRegistry.BadProofInputs.selector);
        reg.bindInvoiceZk(_proof("nic-sample"), inputs);
    }
}
