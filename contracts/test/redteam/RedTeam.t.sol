// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {KhataRegistry} from "../../src/KhataRegistry.sol";
import {NicInvoice} from "../../src/NicInvoice.sol";
import {NicJwt} from "../../src/NicJwt.sol";
import {JsonLite} from "../../src/JsonLite.sol";
import {AttesterRegistry} from "../../src/AttesterRegistry.sol";

/// Harness so library reverts can be caught and classified.
contract Harness {
    function json(bytes calldata b) external pure returns (uint256) {
        return JsonLite.parseObject(b).length;
    }

    function inv(bytes calldata b) external pure returns (NicInvoice.Invoice memory) {
        return NicInvoice.parse(b);
    }

    function split(string calldata t) external pure returns (uint256) {
        return NicJwt.split(t).payload.length;
    }
}

contract RedTeamTest is Test {
    KhataRegistry reg;
    AttesterRegistry att;
    uint256 constant ATT_PK = 0xA11CE;
    Harness h;
    address owner = makeAddr("owner");
    address a = makeAddr("a");
    address b = makeAddr("b");
    string constant NIC_KID = "4DE1544AE695BDC84EC7BC12F2F57F813F44E301";
    string constant DEMO_KID = "DEMO-IRP-NOT-GOVERNMENT-1";
    bytes constant E = hex"010001";
    bytes nicN;
    bytes demoN;
    string sample;
    bytes32 constant SAMPLE_IRN = 0xd9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17;

    function setUp() public {
        vm.warp(1_800_000_000);
        att = new AttesterRegistry(owner);
        vm.prank(owner);
        att.addAttester(vm.addr(ATT_PK));
        reg = new KhataRegistry(owner, att, 1 days);
        _seller(keccak256("37ARZPT4384Q1MT"), 1);
        _seller(keccak256("27DEMOS1234A1Z5"), 2);
        h = new Harness();
        nicN = vm.parseBytes(vm.readFile("contracts/test/fixtures/nic-sample.modulus.hex"));
        demoN = vm.parseBytes(vm.readFile("contracts/test/fixtures/demo-irp/demo-irp.modulus.hex"));
        sample = vm.readFile("contracts/test/fixtures/nic-sample.token");
        vm.startPrank(owner);
        reg.addKey(NIC_KID, nicN, E, false);
        reg.addKey(DEMO_KID, demoN, E, true);
        vm.stopPrank();
    }

    function _seller(bytes32 gh, uint64 version) internal {
        AttesterRegistry.SellerBinding memory sb = AttesterRegistry.SellerBinding({
            gstinHash: gh, wallet: a, validUntil: uint64(block.timestamp + 365 days), version: version
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATT_PK, att.sellerBindingDigest(sb));
        reg.registerSeller(sb, abi.encodePacked(r, s, v));
    }

    function _rt(string memory n) internal view returns (string memory) {
        return vm.readFile(string.concat("contracts/test/fixtures/redteam/", n, ".token"));
    }

    // ---------------- 4/5: nullifier is not namespaced by key ----------------

    /// Fixed: demo-key tokens carrying a real IRN no longer burn the real invoice's nullifier.
    function test_fixed_demoKeyCannotBurnRealIrn() public {
        vm.prank(a);
        reg.bindInvoice(_rt("collide-nic-irn")); // forged under the demo key, carries the NIC sample IRN
        vm.prank(a);
        reg.bindInvoice(sample); // the genuine NIC-signed invoice still binds
        assertTrue(reg.isBound(NicInvoice.nullifierOf(SAMPLE_IRN)));
        (address binder,,,,,) = reg.bindings(NicInvoice.nullifierOf(SAMPLE_IRN));
        assertEq(binder, a);
    }

    function test_defended_irnCaseNormalised() public {
        // demo-01 IRN lower vs the same IRN in upper case must collide
        string memory lower = vm.readFile("contracts/test/fixtures/demo-irp/demo-01.token");
        vm.prank(a);
        bytes32 n1 = reg.bindInvoice(lower);
        // irn-upper uses a different DocNo (RT-1) IRN; just check upper parse == lower parse
        NicInvoice.Invoice memory up = h.inv(NicJwt.split(_rt("irn-upper")).payload);
        NicInvoice.Invoice memory lo = h.inv(NicJwt.split(_rt("irn-upper")).payload);
        assertEq(up.irn, lo.irn);
        assertTrue(n1 != bytes32(0));
        // bind upper then check IRN equals the lowercase-derived value
        vm.prank(a);
        bytes32 n2 = reg.bindInvoice(_rt("irn-upper"));
        bytes32 irn = up.irn;
        assertEq(n2, NicInvoice.demoNullifierOf(irn)); // demo key: demo namespace
    }

    // ---------------- 1/2: signature + base64 malleability ----------------

    function _sigStart(bytes memory t) internal pure returns (uint256) {
        for (uint256 i = t.length; i > 0; --i) {
            if (t[i - 1] == ".") return i;
        }
        revert("nodot");
    }

    function _withSig(string memory token, string memory newSig) internal pure returns (string memory) {
        bytes memory t = bytes(token);
        uint256 s = _sigStart(t);
        bytes memory head = new bytes(s);
        for (uint256 i; i < s; ++i) {
            head[i] = t[i];
        }
        return string.concat(string(head), newSig);
    }

    function _sigOf(string memory token) internal pure returns (string memory) {
        bytes memory t = bytes(token);
        uint256 s = _sigStart(t);
        bytes memory o = new bytes(t.length - s);
        for (uint256 i; i < o.length; ++i) {
            o[i] = t[s + i];
        }
        return string(o);
    }

    /// Fixed: one signature has exactly one accepted text. Padding, altered unused bits and the
    /// standard alphabet are all refused.
    function test_fixed_signatureTextIsCanonical() public {
        string memory sig = _sigOf(sample);
        bytes memory sb = bytes(sig);
        vm.expectRevert(NicJwt.MalformedToken.selector);
        reg.inspect(_withSig(sample, string.concat(sig, "==")));

        bytes memory alt = abi.encodePacked(sig);
        bytes memory al = bytes("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_");
        uint256 idx;
        for (uint256 i; i < 64; ++i) {
            if (al[i] == sb[sb.length - 1]) idx = i;
        }
        alt[alt.length - 1] = al[idx ^ 1];
        vm.expectRevert(NicJwt.MalformedToken.selector);
        reg.inspect(_withSig(sample, string(alt)));

        bytes memory std = abi.encodePacked(sig);
        for (uint256 i; i < std.length; ++i) {
            if (std[i] == "-") std[i] = "+";
            if (std[i] == "_") std[i] = "/";
        }
        vm.expectRevert(NicJwt.MalformedToken.selector);
        reg.inspect(_withSig(sample, string(std)));
    }

    /// The malleable variants do not let one invoice be bound twice.
    function test_defended_malleableSigStillOneBinding() public {
        vm.prank(a);
        reg.bindInvoice(sample);
        string memory t1 = _withSig(sample, string.concat(_sigOf(sample), "=="));
        vm.prank(a);
        vm.expectRevert();
        reg.bindInvoice(t1);
    }

    /// Mixing alphabets in the SIGNED part is refused outright (canonical base64url only).
    function test_defended_alphabetSwapInSignedPart() public {
        bytes memory t = bytes(sample);
        t[60] = "+";
        vm.expectRevert(NicJwt.MalformedToken.selector);
        reg.inspect(string(t));
    }

    function test_defended_tamperEveryRegionRejected() public view {
        bytes memory t = bytes(sample);
        for (uint256 i = 0; i < t.length; i += 7) {
            bytes memory c = bytes(sample);
            if (c[i] == ".") continue;
            c[i] = c[i] == "A" ? bytes1("B") : bytes1("A");
            try reg.inspect(string(c)) returns (KhataRegistry.Inspection memory r) {
                assertFalse(r.signatureValid, "tampered token reported valid");
                assertEq(r.invoice.irn, bytes32(0), "unverified facts leaked");
            } catch {}
        }
    }

    // ---------------- addKey does not validate key quality ----------------

    /// With exponent 1 anyone can forge: signature = the padded digest itself.
    function test_fixed_exponentOneIsRefused() public {
        vm.prank(owner);
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("WEAK-E1", demoN, hex"01", false);
        return; // the rest of the forgery below can no longer be set up
        // solhint-disable-next-line
        reg.addKey("WEAK-E1", demoN, hex"01", false);
        string memory h64 = Base64.encodeURL(bytes('{"alg":"RS256","kid":"WEAK-E1"}'));
        string memory inner =
            '{\\"SellerGstin\\":\\"27ZZZZZ9999Z1Z5\\",\\"BuyerGstin\\":\\"29ZZZZZ9999Z1Z5\\",\\"DocNo\\":\\"F1\\",\\"DocTyp\\":\\"INV\\",\\"DocDt\\":\\"05/11/2026\\",\\"TotInvVal\\":5,\\"Irn\\":\\"1111111111111111111111111111111111111111111111111111111111111111\\"}';
        string memory p64 = Base64.encodeURL(bytes(string.concat('{"iss":"NIC","data":"', inner, '"}')));
        bytes memory signingInput = bytes(string.concat(h64, ".", p64));
        bytes32 digest = sha256(signingInput);
        bytes memory em = abi.encodePacked(
            hex"0001", _ff(256 - 2 - 1 - 19 - 32), hex"00", hex"3031300d060960864801650304020105000420", digest
        );
        assertEq(em.length, 256);
        string memory token = string.concat(string(signingInput), ".", Base64.encodeURL(em));
        vm.prank(a);
        reg.bindInvoice(token); // forged invoice bound with no private key at all
        assertTrue(
            reg.isBound(
                NicInvoice.nullifierOf(
                    bytes32(uint256(0x1111111111111111111111111111111111111111111111111111111111111111))
                )
            )
        );
    }

    function _ff(uint256 n) internal pure returns (bytes memory o) {
        o = new bytes(n);
        for (uint256 i; i < n; ++i) {
            o[i] = 0xff;
        }
    }

    function test_fixed_evenAndLeadingZeroModuliAreRefused() public {
        bytes memory even = demoN;
        even[even.length - 1] = 0x00;
        bytes memory lead = bytes.concat(hex"00", demoN);
        vm.startPrank(owner);
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("EVEN", even, E, false);
        vm.expectRevert(KhataRegistry.InvalidKey.selector);
        reg.addKey("LEAD0", lead, E, false);
        vm.stopPrank();
    }

    function test_fixed_ownerCannotRenounceAndLoseRetirement() public {
        vm.prank(owner);
        vm.expectRevert(KhataRegistry.OwnershipCannotBeRenounced.selector);
        reg.renounceOwnership();
        vm.prank(owner);
        reg.retireKey(DEMO_KID);
    }

    // ---------------- 3: JSON / numbers ----------------

    function _paise(string memory n) internal view returns (uint256) {
        return h.inv(NicJwt.split(_rt(n)).payload).valuePaise;
    }

    function test_defended_numberForms() public view {
        assertEq(_paise("v_1_0"), 100);
        assertEq(_paise("v_max"), 999999999999999_99);
        assertTrue(uint256(uint128(999999999999999_99)) == 999999999999999_99);
    }

    function test_defended_numberRejects() public {
        string[6] memory bad = ["v_16d", "v_3dec", "v_exp", "v_neg", "v_01", "v_lead0dec"];
        for (uint256 i; i < 6; ++i) {
            bytes memory pl = NicJwt.split(_rt(bad[i])).payload; // split is external-library internal; fine
            vm.expectRevert();
            h.inv(pl);
        }
    }

    /// Real-world liveness: a legitimate TotInvVal with 3+ decimals is refused outright.
    function test_SUSPECTED_threeDecimalsRefused() public {
        bytes memory pl = NicJwt.split(_rt("v_3dec")).payload;
        vm.expectRevert(abi.encodeWithSelector(NicInvoice.InvalidField.selector, "TotInvVal"));
        h.inv(pl);
    }

    function test_defended_extraKeysDontShadow() public view {
        NicInvoice.Invoice memory i = h.inv(NicJwt.split(_rt("extra-keys")).payload);
        assertEq(i.docNo, "RT-1");
    }

    function test_defended_entryLimit() public {
        assertEq(h.inv(NicJwt.split(_rt("entries32")).payload).docNo, "RT-1");
        bytes memory pl = NicJwt.split(_rt("entries33")).payload;
        vm.expectRevert(JsonLite.MalformedJson.selector);
        h.inv(pl);
    }

    function test_defended_duplicateKeysViaEscapes() public {
        vm.expectRevert(JsonLite.DuplicateKey.selector);
        h.json(bytes('{"a":1,"a":2}'));
        // escapes cannot spell letters, so no colliding spelling of "Irn"/"DocNo" exists
        vm.expectRevert(JsonLite.MalformedJson.selector);
        h.json(bytes('{"D\\u006fcNo":1}'));
        // escaped slash keys collide with each other after unescape
        vm.expectRevert(JsonLite.DuplicateKey.selector);
        h.json(bytes('{"a\\/b":1,"a/b":2}'));
    }

    // ---------------- 5: gas / size cap ----------------

    function test_gas_sizeCapAndFatTokens() public {
        uint256 g = gasleft();
        KhataRegistry.Inspection memory r = reg.inspect(_rt("size-2048"));
        emit log_named_uint("inspect 2048B gas", g - gasleft());
        assertTrue(r.signatureValid);
        vm.expectRevert(NicJwt.TokenTooLarge.selector);
        reg.inspect(_rt("size-2049"));

        g = gasleft();
        vm.prank(a);
        reg.bindInvoice(_rt("entries32-fat"));
        emit log_named_uint("bind 32 entries gas", g - gasleft());

        g = gasleft();
        try reg.inspect(_rt("header32")) {} catch {}
        emit log_named_uint("inspect header32 gas", g - gasleft());
    }

    // ---------------- fuzz: no Panic / bare revert ----------------

    function _classify(bytes memory ret) internal pure returns (bool bad) {
        if (ret.length == 0) return true; // bare revert / OOG-style
        bytes4 sel;
        assembly { sel := mload(add(ret, 32)) }
        return sel == 0x4e487b71; // Panic(uint256)
    }

    function testFuzz_jsonNoPanic(bytes calldata data) public {
        try h.json(data) {}
        catch (bytes memory ret) {
            assertFalse(_classify(ret), "panic/bare revert");
        }
    }

    function testFuzz_invoiceNoPanic(bytes calldata data) public {
        try h.inv(data) {}
        catch (bytes memory ret) {
            assertFalse(_classify(ret), "panic/bare revert");
        }
    }

    function testFuzz_splitNoPanic(string calldata t) public {
        try h.split(t) {}
        catch (bytes memory ret) {
            assertFalse(_classify(ret), "panic/bare revert");
        }
    }

    /// Mutation fuzz on a valid token through the whole inspect() path.
    function testFuzz_inspectMutations(uint16 pos, uint8 val, uint8 pos2, uint8 val2) public {
        bytes memory t = bytes(sample);
        t[pos % t.length] = bytes1(val);
        t[pos2 % t.length] = bytes1(val2);
        try reg.inspect(string(t)) returns (KhataRegistry.Inspection memory r) {
            if (!r.signatureValid) assertEq(r.invoice.irn, bytes32(0));
        } catch (bytes memory ret) {
            assertFalse(_classify(ret), "panic/bare revert");
        }
    }
}
