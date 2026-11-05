// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {NicVerifier} from "../src/NicVerifier.sol";
import {NicInvoice} from "../src/NicInvoice.sol";
import {JsonLite} from "../src/JsonLite.sol";

contract NicInvoiceTest is Test {
    NicVerifier internal v;

    string internal constant SELLER = "37ARZPT4384Q1MT";
    string internal constant BUYER = "29AWGPV7107B1Z1";
    string internal constant IRN = "d9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17";

    function setUp() public {
        v = new NicVerifier();
    }

    // ---------- helpers ----------

    /// Wraps an inner JSON text the way NIC does: {"iss":"NIC","data":"<escaped JSON string>"}.
    function _token(string memory inner) internal pure returns (string memory) {
        return _tokenWithPayload(string.concat('{"iss":"NIC","data":"', _escape(inner), '"}'));
    }

    function _tokenWithPayload(string memory payload) internal pure returns (string memory) {
        string memory header = Base64.encodeURL(bytes('{"alg":"RS256","kid":"K1","typ":"JWT"}'));
        return string.concat(header, ".", _b64u(payload), ".AAAA");
    }

    function _b64u(string memory s) internal pure returns (string memory) {
        return Base64.encodeURL(bytes(s));
    }

    function _escape(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length * 2);
        uint256 n;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == '"' || b[i] == "\\") out[n++] = "\\";
            out[n++] = b[i];
        }
        assembly ("memory-safe") {
            mstore(out, n)
        }
        return string(out);
    }

    function _inner(string memory docNo, string memory docTyp, string memory value)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"',
            docNo,
            '","DocTyp":"',
            docTyp,
            '","DocDt":"14/07/2025","TotInvVal":',
            value,
            ',"ItemCnt":1,"MainHsnCode":"010190","Irn":"',
            IRN,
            '","IrnDt":"2025-07-14 12:44:00"}'
        );
    }

    function _revertsInvalid(string memory token, string memory field) internal {
        vm.expectRevert(abi.encodeWithSelector(NicInvoice.InvalidField.selector, field));
        v.parseInvoice(token);
    }

    // ---------- the sample ----------

    function test_parsesNicSample() public view {
        NicInvoice.Invoice memory inv = v.parseInvoice(vm.readFile("contracts/test/fixtures/nic-sample.token"));
        assertEq(inv.sellerGstin, SELLER);
        assertEq(inv.buyerGstin, BUYER);
        assertEq(inv.docNo, "Test-00df1");
        assertEq(inv.docDt, "14/07/2025");
        assertEq(inv.valuePaise, 200);
        assertEq(inv.irn, bytes32(0xd9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17));
        assertTrue(inv.hasIrnDt);
        assertEq(inv.irnDt, "2025-07-14 12:44:00");
    }

    // ---------- payload variance ----------

    function test_parsesWithoutIrnDt() public view {
        string memory inner = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"A/1","DocTyp":"INV",',
            '"DocDt":"01/01/2024","TotInvVal":10.5,"Irn":"',
            IRN,
            '"}'
        );
        NicInvoice.Invoice memory inv = v.parseInvoice(_token(inner));
        assertFalse(inv.hasIrnDt);
        assertEq(bytes(inv.irnDt).length, 0);
        assertEq(inv.valuePaise, 1050);
    }

    function test_parsesWhenFieldOrderDiffers() public view {
        string memory inner = string.concat(
            '{"Irn":"',
            IRN,
            '","TotInvVal":99,"DocDt":"01/01/2024","DocTyp":"INV","DocNo":"X-9",',
            '"BuyerGstin":"',
            BUYER,
            '","SellerGstin":"',
            SELLER,
            '"}'
        );
        NicInvoice.Invoice memory inv = v.parseInvoice(_token(inner));
        assertEq(inv.docNo, "X-9");
        assertEq(inv.valuePaise, 9900);
    }

    function test_ignoresUnknownFieldsAndWhitespace() public view {
        string memory inner = string.concat(
            '{ "Extra" : "x" ,"SellerGstin":"',
            SELLER,
            '", "BuyerGstin":"',
            BUYER,
            '","DocNo":"A1","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":1,"Flag":true,"Irn":"',
            IRN,
            '" }'
        );
        assertEq(v.parseInvoice(_token(inner)).docNo, "A1");
    }

    function test_acceptsUppercaseIrnAsSameValue() public view {
        string memory upper = "D9476807F5496DEA9FC65C6A954887DB156022BA4B0D17A3687D43576BEB8E17";
        string memory inner = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"A1","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":1,"Irn":"',
            upper,
            '"}'
        );
        assertEq(
            v.parseInvoice(_token(inner)).irn,
            bytes32(0xd9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17)
        );
    }

    // ---------- values ----------

    function test_valueParsing() public view {
        assertEq(v.parseInvoice(_token(_inner("A1", "INV", "2"))).valuePaise, 200);
        assertEq(v.parseInvoice(_token(_inner("A1", "INV", "2.0"))).valuePaise, 200);
        assertEq(v.parseInvoice(_token(_inner("A1", "INV", "2.5"))).valuePaise, 250);
        assertEq(v.parseInvoice(_token(_inner("A1", "INV", "118000.05"))).valuePaise, 11800005);
        assertEq(v.parseInvoice(_token(_inner("A1", "INV", "0.01"))).valuePaise, 1);
    }

    function test_rejectsBadValues() public {
        _revertsInvalid(_token(_inner("A1", "INV", "2.555")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", "-2")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", "1e3")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", "2.")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", ".5")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", "0")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", "null")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", "1234567890123456789")), "TotInvVal");
    }

    /// Red team: "01" and "007" are not valid JSON numbers and must not read as 1 or 7.
    function test_rejectsLeadingZeroValues() public {
        _revertsInvalid(_token(_inner("A1", "INV", "01")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", "007")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", "00.50")), "TotInvVal");
        _revertsInvalid(_token(_inner("A1", "INV", "000000000000001.50")), "TotInvVal");
        assertEq(v.parseInvoice(_token(_inner("A1", "INV", "0.5"))).valuePaise, 50);
        assertEq(v.parseInvoice(_token(_inner("A1", "INV", "10"))).valuePaise, 1000);
    }

    function test_rejectsStringValue() public {
        string memory inner = _inner("A1", "INV", '"2"');
        // value given as a JSON string rather than a number
        inner = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"A1","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":"2","Irn":"',
            IRN,
            '"}'
        );
        _revertsInvalid(_token(inner), "TotInvVal");
    }

    // ---------- document type and field limits ----------

    function test_rejectsNonInvoiceDocTypes() public {
        _revertsInvalid(_token(_inner("A1", "CRN", "2")), "DocTyp");
        _revertsInvalid(_token(_inner("A1", "DBN", "2")), "DocTyp");
        _revertsInvalid(_token(_inner("A1", "inv", "2")), "DocTyp");
        _revertsInvalid(_token(_inner("A1", "INVX", "2")), "DocTyp");
    }

    function test_docNoLimits() public {
        assertEq(v.parseInvoice(_token(_inner("1234567890123456", "INV", "2"))).docNo, "1234567890123456"); // 16 chars
        _revertsInvalid(_token(_inner("12345678901234567", "INV", "2")), "DocNo"); // 17 chars
        _revertsInvalid(_token(_inner("", "INV", "2")), "DocNo");
        _revertsInvalid(_token(_inner("A 1", "INV", "2")), "DocNo");
        _revertsInvalid(_token(_inner("A,1", "INV", "2")), "DocNo");
    }

    /// A DocNo trying to smuggle a quote or a second key must be refused by the field rules.
    function test_rejectsInjectedQuoteInDocNo() public {
        // inner JSON text where DocNo is: A1\",\"DocTyp\":\"CRN  (an escaped quote inside the inner string)
        string memory inner = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"A1\\",\\"DocTyp\\":\\"CRN","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":2,"Irn":"',
            IRN,
            '"}'
        );
        _revertsInvalid(_token(inner), "DocNo");
    }

    function test_gstinMustBeFifteenUppercaseAlphanumerics() public {
        string memory short_ = string.concat(
            '{"SellerGstin":"37ARZPT4384Q1M","BuyerGstin":"',
            BUYER,
            '","DocNo":"A1","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":2,"Irn":"',
            IRN,
            '"}'
        );
        _revertsInvalid(_token(short_), "SellerGstin");
        string memory lower = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"29awgpv7107b1z1',
            '","DocNo":"A1","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":2,"Irn":"',
            IRN,
            '"}'
        );
        _revertsInvalid(_token(lower), "BuyerGstin");
    }

    function test_irnMustBe64Hex() public {
        string memory shortIrn = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"A1","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":2,"Irn":"abcd"}'
        );
        _revertsInvalid(_token(shortIrn), "Irn");
        string memory nonHex = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"A1","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":2,"Irn":"',
            "g9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17",
            '"}'
        );
        _revertsInvalid(_token(nonHex), "Irn");
    }

    function test_docDtShape() public {
        string memory bad = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"A1","DocTyp":"INV","DocDt":"2025-07-14","TotInvVal":2,"Irn":"',
            IRN,
            '"}'
        );
        _revertsInvalid(_token(bad), "DocDt");
        string memory badMonth = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"A1","DocTyp":"INV","DocDt":"14/13/2025","TotInvVal":2,"Irn":"',
            IRN,
            '"}'
        );
        _revertsInvalid(_token(badMonth), "DocDt");
    }

    function test_missingRequiredFieldReverts() public {
        string memory inner = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":2,"Irn":"',
            IRN,
            '"}'
        );
        vm.expectRevert(abi.encodeWithSelector(NicInvoice.MissingField.selector, "DocNo"));
        v.parseInvoice(_token(inner));
    }

    // ---------- structure ----------

    function test_rejectsDuplicateKeys() public {
        string memory inner = string.concat(
            '{"SellerGstin":"',
            SELLER,
            '","BuyerGstin":"',
            BUYER,
            '","DocNo":"A1","DocNo":"A2","DocTyp":"INV","DocDt":"01/01/2024","TotInvVal":2,"Irn":"',
            IRN,
            '"}'
        );
        vm.expectRevert(JsonLite.DuplicateKey.selector);
        v.parseInvoice(_token(inner));
    }

    function test_rejectsMalformedInnerJson() public {
        vm.expectRevert(JsonLite.MalformedJson.selector);
        v.parseInvoice(_token('{"SellerGstin":"x"'));
        vm.expectRevert(JsonLite.MalformedJson.selector);
        v.parseInvoice(_token("not json"));
        vm.expectRevert(JsonLite.MalformedJson.selector);
        v.parseInvoice(_token('{"a":{"nested":1}}'));
        vm.expectRevert(JsonLite.MalformedJson.selector);
        v.parseInvoice(_token('{"a":[1]}'));
        vm.expectRevert(JsonLite.MalformedJson.selector);
        v.parseInvoice(_token('{"a":"b"} trailing'));
        vm.expectRevert(JsonLite.MalformedJson.selector);
        v.parseInvoice(_token('{"a":"\\u0041"}'));
    }

    function test_rejectsWrongIssuer() public {
        string memory payload = string.concat('{"iss":"EVIL","data":"', _escape(_inner("A1", "INV", "2")), '"}');
        vm.expectRevert(NicInvoice.WrongIssuer.selector);
        v.parseInvoice(_tokenWithPayload(payload));
    }

    function test_rejectsMissingOrNonStringData() public {
        vm.expectRevert(abi.encodeWithSelector(NicInvoice.MissingField.selector, "data"));
        v.parseInvoice(_tokenWithPayload('{"iss":"NIC"}'));
        vm.expectRevert(abi.encodeWithSelector(NicInvoice.InvalidField.selector, "data"));
        v.parseInvoice(_tokenWithPayload('{"iss":"NIC","data":5}'));
    }

    function test_rejectsDuplicateOuterKeys() public {
        vm.expectRevert(JsonLite.DuplicateKey.selector);
        v.parseInvoice(_tokenWithPayload('{"iss":"NIC","data":"{}","data":"{}"}'));
    }

    function test_rejectsTooManyKeys() public {
        bytes memory inner = "{";
        for (uint256 i; i < 40; ++i) {
            inner = bytes.concat(inner, i == 0 ? bytes("") : bytes(","), '"k', bytes(vm.toString(i)), '":1');
        }
        inner = bytes.concat(inner, "}");
        vm.expectRevert(JsonLite.MalformedJson.selector);
        v.parseInvoice(_token(string(inner)));
    }

    // ---------- nullifier ----------

    function test_nullifierIsDomainSeparatedHashOfIrn() public view {
        bytes32 irn = 0xd9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17;
        assertEq(NicInvoice.nullifierOf(irn), keccak256(abi.encodePacked("KHATA_IRN_V1", irn)));
        assertEq(v.nullifierOf(irn), NicInvoice.nullifierOf(irn));
    }
}
