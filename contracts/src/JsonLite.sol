// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Strict parser for flat JSON objects (string and scalar values only).
/// @dev Nested objects and arrays are rejected. Duplicate keys are rejected. Only the escapes
///      `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t` are accepted; `\u` escapes are rejected.
library JsonLite {
    error MalformedJson();
    error DuplicateKey();

    uint256 internal constant MAX_ENTRIES = 32;

    struct Entry {
        bytes key;
        bytes value; // unescaped string contents, or the raw text of a number/literal
        bool isString;
    }

    function find(Entry[] memory entries, string memory key) internal pure returns (bool, Entry memory) {
        bytes32 h = keccak256(bytes(key));
        for (uint256 i; i < entries.length; ++i) {
            if (keccak256(entries[i].key) == h) return (true, entries[i]);
        }
        return (false, Entry("", "", false));
    }

    function parseObject(bytes memory j) internal pure returns (Entry[] memory out) {
        Entry[] memory tmp = new Entry[](MAX_ENTRIES);
        uint256 n;
        uint256 i = _ws(j, 0);
        if (i >= j.length || j[i] != "{") revert MalformedJson();
        i = _ws(j, i + 1);

        if (i < j.length && j[i] == "}") {
            i = _ws(j, i + 1);
            if (i != j.length) revert MalformedJson();
            return new Entry[](0);
        }

        while (true) {
            if (n == MAX_ENTRIES) revert MalformedJson();
            Entry memory e;
            (e.key, i) = _string(j, i);
            i = _ws(j, i);
            if (i >= j.length || j[i] != ":") revert MalformedJson();
            i = _ws(j, i + 1);
            if (i >= j.length) revert MalformedJson();
            if (j[i] == '"') {
                e.isString = true;
                (e.value, i) = _string(j, i);
            } else {
                (e.value, i) = _scalar(j, i);
            }
            bytes32 kh = keccak256(e.key);
            for (uint256 k; k < n; ++k) {
                if (keccak256(tmp[k].key) == kh) revert DuplicateKey();
            }
            tmp[n++] = e;

            i = _ws(j, i);
            if (i >= j.length) revert MalformedJson();
            if (j[i] == ",") {
                i = _ws(j, i + 1);
                continue;
            }
            if (j[i] == "}") {
                i = _ws(j, i + 1);
                if (i != j.length) revert MalformedJson();
                break;
            }
            revert MalformedJson();
        }

        out = new Entry[](n);
        for (uint256 m; m < n; ++m) {
            out[m] = tmp[m];
        }
    }

    function _ws(bytes memory j, uint256 i) private pure returns (uint256) {
        while (i < j.length) {
            bytes1 c = j[i];
            if (c != 0x20 && c != 0x09 && c != 0x0a && c != 0x0d) break;
            ++i;
        }
        return i;
    }

    /// @dev Reads a JSON string starting at the opening quote; returns the unescaped bytes and the index after the closing quote.
    function _string(bytes memory j, uint256 i) private pure returns (bytes memory, uint256) {
        if (i >= j.length || j[i] != '"') revert MalformedJson();
        ++i;
        bytes memory buf = new bytes(j.length - i);
        uint256 len;
        while (i < j.length) {
            bytes1 c = j[i];
            if (c == '"') {
                assembly ("memory-safe") {
                    mstore(buf, len)
                }
                return (buf, i + 1);
            }
            if (uint8(c) < 0x20) revert MalformedJson();
            if (c == "\\") {
                if (i + 1 >= j.length) revert MalformedJson();
                bytes1 x = j[i + 1];
                if (x == '"' || x == "\\" || x == "/") c = x;
                else if (x == "b") c = 0x08;
                else if (x == "f") c = 0x0c;
                else if (x == "n") c = 0x0a;
                else if (x == "r") c = 0x0d;
                else if (x == "t") c = 0x09;
                else revert MalformedJson();
                i += 2;
            } else {
                ++i;
            }
            buf[len++] = c;
        }
        revert MalformedJson();
    }

    /// @dev Reads a number or literal (true/false/null) up to the next delimiter.
    function _scalar(bytes memory j, uint256 i) private pure returns (bytes memory, uint256) {
        uint256 start = i;
        while (i < j.length) {
            bytes1 c = j[i];
            bool ok = (c >= "0" && c <= "9") || (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c == "." || c == "+"
                || c == "-";
            if (!ok) break;
            ++i;
        }
        if (i == start) revert MalformedJson();
        bytes memory out = new bytes(i - start);
        for (uint256 k; k < out.length; ++k) {
            out[k] = j[start + k];
        }
        return (out, i);
    }
}
