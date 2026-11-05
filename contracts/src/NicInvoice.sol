// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Bytes} from "@openzeppelin/contracts/utils/Bytes.sol";
import {JsonLite} from "./JsonLite.sol";

/// @notice Extracts and validates the invoice fields from the payload of a NIC e-invoice QR token.
/// @dev The payload is `{"iss":"NIC","data":"<escaped JSON string>"}`. Fields are looked up by name,
///      so key order and extra keys do not matter. Every field used later is validated against a strict
///      character set, which also stops injected quotes from changing the meaning of other fields.
library NicInvoice {
    error WrongIssuer();
    error MissingField(string field);
    error InvalidField(string field);

    uint256 internal constant MAX_VALUE_INTEGER_DIGITS = 15;

    struct Invoice {
        string sellerGstin;
        string buyerGstin;
        string docNo;
        string docDt; // DD/MM/YYYY
        uint256 valuePaise; // TotInvVal in hundredths of a rupee
        bytes32 irn;
        bool hasIrnDt; // older QR vintages carry no IrnDt
        string irnDt; // YYYY-MM-DD HH:MM:SS, empty when absent
    }

    /// @dev One value shared by every financing path for government-signed invoices (plain RSA and any
    ///      future proof path).
    function nullifierOf(bytes32 irn) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("KHATA_IRN_V1", irn));
    }

    /// @dev Invoices signed by a labelled demo key live in their own namespace, so a demo token that
    ///      carries a real IRN can never burn the real invoice's nullifier.
    function demoNullifierOf(bytes32 irn) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("KHATA_DEMO_IRN_V1", irn));
    }

    function parse(bytes memory payload) internal pure returns (Invoice memory inv) {
        JsonLite.Entry[] memory outer = JsonLite.parseObject(payload);

        (bool hasIss, JsonLite.Entry memory iss) = JsonLite.find(outer, "iss");
        if (!hasIss || !iss.isString || !Bytes.equal(iss.value, "NIC")) revert WrongIssuer();

        (bool hasData, JsonLite.Entry memory data) = JsonLite.find(outer, "data");
        if (!hasData) revert MissingField("data");
        if (!data.isString) revert InvalidField("data");

        JsonLite.Entry[] memory f = JsonLite.parseObject(data.value);

        inv.sellerGstin = string(_gstin(f, "SellerGstin"));
        inv.buyerGstin = string(_gstin(f, "BuyerGstin"));
        inv.docNo = string(_docNo(f));
        _requireDocTyp(f);
        inv.docDt = string(_docDt(f));
        inv.valuePaise = _value(f);
        inv.irn = _irn(f);

        (bool hasIrnDt, JsonLite.Entry memory irnDt) = JsonLite.find(f, "IrnDt");
        if (hasIrnDt) {
            if (!irnDt.isString || !_isDateTime(irnDt.value)) revert InvalidField("IrnDt");
            inv.hasIrnDt = true;
            inv.irnDt = string(irnDt.value);
        }
    }

    // ---------- field rules ----------

    function _get(JsonLite.Entry[] memory f, string memory name, bool wantString) private pure returns (bytes memory) {
        (bool ok, JsonLite.Entry memory e) = JsonLite.find(f, name);
        if (!ok) revert MissingField(name);
        if (e.isString != wantString) revert InvalidField(name);
        return e.value;
    }

    /// 15 characters, digits and uppercase letters.
    function _gstin(JsonLite.Entry[] memory f, string memory name) private pure returns (bytes memory v) {
        v = _get(f, name, true);
        if (v.length != 15) revert InvalidField(name);
        for (uint256 i; i < 15; ++i) {
            bytes1 c = v[i];
            if (!((c >= "0" && c <= "9") || (c >= "A" && c <= "Z"))) revert InvalidField(name);
        }
    }

    /// 1 to 16 characters from letters, digits, '/' and '-' (the GST rule for document numbers).
    function _docNo(JsonLite.Entry[] memory f) private pure returns (bytes memory v) {
        v = _get(f, "DocNo", true);
        if (v.length == 0 || v.length > 16) revert InvalidField("DocNo");
        for (uint256 i; i < v.length; ++i) {
            bytes1 c = v[i];
            bool ok = (c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c == "/" || c == "-";
            if (!ok) revert InvalidField("DocNo");
        }
    }

    function _requireDocTyp(JsonLite.Entry[] memory f) private pure {
        if (!Bytes.equal(_get(f, "DocTyp", true), "INV")) revert InvalidField("DocTyp");
    }

    /// DD/MM/YYYY with day 01-31 and month 01-12.
    function _docDt(JsonLite.Entry[] memory f) private pure returns (bytes memory v) {
        v = _get(f, "DocDt", true);
        if (v.length != 10 || v[2] != "/" || v[5] != "/") revert InvalidField("DocDt");
        for (uint256 i; i < 10; ++i) {
            if (i == 2 || i == 5) continue;
            if (v[i] < "0" || v[i] > "9") revert InvalidField("DocDt");
        }
        uint256 day = (uint8(v[0]) - 48) * 10 + (uint8(v[1]) - 48);
        uint256 month = (uint8(v[3]) - 48) * 10 + (uint8(v[4]) - 48);
        if (day < 1 || day > 31 || month < 1 || month > 12) revert InvalidField("DocDt");
    }

    /// A plain decimal number: digits, optionally '.' and one or two digits. Returns hundredths.
    function _value(JsonLite.Entry[] memory f) private pure returns (uint256 paise) {
        bytes memory v = _get(f, "TotInvVal", false);
        uint256 n = v.length;
        uint256 dot = n;
        for (uint256 i; i < n; ++i) {
            if (v[i] == ".") {
                if (dot != n) revert InvalidField("TotInvVal");
                dot = i;
            } else if (v[i] < "0" || v[i] > "9") {
                revert InvalidField("TotInvVal");
            }
        }
        if (dot == 0) revert InvalidField("TotInvVal");
        if (dot > 1 && v[0] == "0") revert InvalidField("TotInvVal"); // JSON forbids leading zeros
        if (dot > MAX_VALUE_INTEGER_DIGITS) revert InvalidField("TotInvVal");
        uint256 frac = dot == n ? 0 : n - dot - 1;
        if (dot != n && (frac == 0 || frac > 2)) revert InvalidField("TotInvVal");

        uint256 whole;
        for (uint256 i; i < dot; ++i) {
            whole = whole * 10 + (uint8(v[i]) - 48);
        }
        uint256 cents;
        if (frac == 1) cents = (uint8(v[dot + 1]) - 48) * 10;
        if (frac == 2) cents = (uint8(v[dot + 1]) - 48) * 10 + (uint8(v[dot + 2]) - 48);
        paise = whole * 100 + cents;
        if (paise == 0) revert InvalidField("TotInvVal");
    }

    /// 64 hex characters, either case, decoded to 32 bytes.
    function _irn(JsonLite.Entry[] memory f) private pure returns (bytes32 out) {
        bytes memory v = _get(f, "Irn", true);
        if (v.length != 64) revert InvalidField("Irn");
        uint256 acc;
        for (uint256 i; i < 64; ++i) {
            uint8 c = uint8(v[i]);
            uint256 d;
            if (c >= 48 && c <= 57) d = c - 48;
            else if (c >= 97 && c <= 102) d = c - 87;
            else if (c >= 65 && c <= 70) d = c - 55;
            else revert InvalidField("Irn");
            acc = (acc << 4) | d;
        }
        out = bytes32(acc);
    }

    /// YYYY-MM-DD HH:MM:SS
    function _isDateTime(bytes memory v) private pure returns (bool) {
        if (v.length != 19 || v[4] != "-" || v[7] != "-" || v[10] != " " || v[13] != ":" || v[16] != ":") return false;
        for (uint256 i; i < 19; ++i) {
            if (i == 4 || i == 7 || i == 10 || i == 13 || i == 16) continue;
            if (v[i] < "0" || v[i] > "9") return false;
        }
        return true;
    }
}
