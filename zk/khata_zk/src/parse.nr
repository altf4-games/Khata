// Field extraction from the decoded NIC payload. The payload is the outer JSON
// {"iss":"NIC","data":"{\"SellerGstin\":\"...\",...}"} where the inner JSON is an escaped string.
// Every value is read at a position the prover supplies, and each position is checked against
// the bytes around it, so the prover cannot point at text that is not a real key of the document.

pub global MAX_VALUE_LEN: u32 = 18; // 15 integer digits, a dot and 2 decimals

pub struct Positions {
    pub gstin: u32,
    pub doctyp: u32,
    pub value: u32,
    pub value_len: u32,
    pub irn: u32,
}

pub struct Fields {
    pub gstin: [u8; 15],
    pub paise: u64,
    pub irn: [u8; 32],
}

// Checks that `marker` sits at `at` and that the byte before it is '{' or ','. Markers start with the escaped
// quote of an inner key. A quote inside a value is escaped twice in the outer JSON, so '{' or ',' directly before
// a lone \" can only be real inner-JSON syntax, never text inside a value.
fn expect_marker<let P: u32, let M: u32>(payload: [u8; P], at: u32, marker: [u8; M]) {
    assert(at >= 1, "wrong field");
    assert(at + M < P, "wrong field");
    let before = payload[at - 1];
    assert((before == 123) | (before == 44), "wrong field");
    for i in 0..M {
        assert(payload[at + i] == marker[i], "wrong field");
    }
}

fn hex_nibble(c: u8) -> u8 {
    let is_digit = (c >= 48) & (c <= 57);
    let is_lower = (c >= 97) & (c <= 102);
    let is_upper = (c >= 65) & (c <= 70);
    assert(is_digit | is_lower | is_upper, "bad irn");
    if is_digit {
        c - 48
    } else if is_lower {
        c - 87
    } else {
        c - 55
    }
}

pub fn parse_invoice<let P: u32>(payload: [u8; P], pos: Positions) -> Fields {
    // Every marker below is: backslash, quote, key, backslash, quote, colon [, backslash, quote].
    // The value starts right after the marker. `pos.*` point at the value, so the marker ends there.
    let gstin_marker = "\\\"SellerGstin\\\":\\\"".as_bytes();
    let doctyp_marker = "\\\"DocTyp\\\":\\\"".as_bytes();
    let value_marker = "\\\"TotInvVal\\\":".as_bytes();
    let irn_marker = "\\\"Irn\\\":\\\"".as_bytes();

    expect_marker(payload, pos.gstin - gstin_marker.len(), gstin_marker);
    expect_marker(payload, pos.doctyp - doctyp_marker.len(), doctyp_marker);
    expect_marker(payload, pos.value - value_marker.len(), value_marker);
    expect_marker(payload, pos.irn - irn_marker.len(), irn_marker);

    // SellerGstin: 15 characters, digits and uppercase letters, then the closing escaped quote.
    let mut gstin = [0 as u8; 15];
    for i in 0..15 {
        let c = payload[pos.gstin + i];
        assert(((c >= 48) & (c <= 57)) | ((c >= 65) & (c <= 90)), "bad gstin");
        gstin[i] = c;
    }
    assert(payload[pos.gstin + 15] == 92, "bad gstin");
    assert(payload[pos.gstin + 16] == 34, "bad gstin");

    // DocTyp must be INV, which excludes credit and debit notes.
    assert(payload[pos.doctyp] == 73, "not an invoice");
    assert(payload[pos.doctyp + 1] == 78, "not an invoice");
    assert(payload[pos.doctyp + 2] == 86, "not an invoice");
    assert(payload[pos.doctyp + 3] == 92, "not an invoice");
    assert(payload[pos.doctyp + 4] == 34, "not an invoice");

    // Irn: 64 hex characters of either case, as 32 bytes, then the closing escaped quote.
    let mut irn = [0 as u8; 32];
    for i in 0..32 {
        irn[i] = hex_nibble(payload[pos.irn + 2 * i]) * 16 + hex_nibble(payload[pos.irn + 2 * i + 1]);
    }
    assert(payload[pos.irn + 64] == 92, "bad irn");
    assert(payload[pos.irn + 65] == 34, "bad irn");

    // TotInvVal: a plain decimal number with an optional dot and one or two decimals, then a comma.
    assert(pos.value_len >= 1, "bad value");
    assert(pos.value_len <= MAX_VALUE_LEN, "bad value");
    assert(payload[pos.value + pos.value_len] == 44, "bad value");
    let mut dots: u32 = 0;
    let mut dot_at: u32 = pos.value_len;
    for i in 0..MAX_VALUE_LEN {
        if i < pos.value_len {
            let c = payload[pos.value + i];
            if c == 46 {
                dots += 1;
                dot_at = i;
            } else {
                assert((c >= 48) & (c <= 57), "bad value");
            }
        }
    }
    assert(dots <= 1, "bad value");
    assert(dot_at >= 1, "bad value");
    assert(dot_at <= 15, "bad value");
    if dot_at > 1 {
        assert(payload[pos.value] != 48, "bad value");
    }
    let frac_len = if dots == 1 { pos.value_len - dot_at - 1 } else { 0 };
    if dots == 1 {
        assert((frac_len >= 1) & (frac_len <= 2), "bad value");
    }
    let mut whole: u64 = 0;
    for i in 0..15 {
        if i < dot_at {
            whole = whole * 10 + (payload[pos.value + i] - 48) as u64;
        }
    }
    let mut cents: u64 = 0;
    if frac_len == 1 {
        cents = (payload[pos.value + dot_at + 1] - 48) as u64 * 10;
    }
    if frac_len == 2 {
        cents = (payload[pos.value + dot_at + 1] - 48) as u64 * 10
            + (payload[pos.value + dot_at + 2] - 48) as u64;
    }
    let paise = whole * 100 + cents;
    assert(paise != 0, "bad value");

    Fields { gstin, paise, irn }
}

global SAMPLE: str<332> = "{\"iss\":\"NIC\",\"data\":\"{\\\"SellerGstin\\\":\\\"37ARZPT4384Q1MT\\\",\\\"BuyerGstin\\\":\\\"29AWGPV7107B1Z1\\\",\\\"DocNo\\\":\\\"Test-00df1\\\",\\\"DocTyp\\\":\\\"INV\\\",\\\"DocDt\\\":\\\"14/07/2025\\\",\\\"TotInvVal\\\":2,\\\"ItemCnt\\\":1,\\\"MainHsnCode\\\":\\\"010190\\\",\\\"Irn\\\":\\\"d9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17\\\",\\\"IrnDt\\\":\\\"2025-07-14 12:44:00\\\"}\"}";

fn buffer<let N: u32>(s: str<N>) -> [u8; 448] {
    let mut out = [0 as u8; 448];
    let b = s.as_bytes();
    for i in 0..N {
        out[i] = b[i];
    }
    out
}

fn find<let N: u32, let M: u32>(s: str<N>, needle: str<M>) -> u32 {
    let h = s.as_bytes();
    let n = needle.as_bytes();
    let mut at = 0;
    let mut found = false;
    for i in 0..(N - M + 1) {
        let mut hit = true;
        for j in 0..M {
            if h[i + j] != n[j] {
                hit = false;
            }
        }
        if hit & !found {
            at = i;
            found = true;
        }
    }
    assert(found);
    at
}

fn sample_positions() -> Positions {
    Positions {
        gstin: find(SAMPLE, "\\\"SellerGstin\\\":\\\"") + 18,
        doctyp: find(SAMPLE, "\\\"DocTyp\\\":\\\"") + 13,
        value: find(SAMPLE, "\\\"TotInvVal\\\":") + 14,
        value_len: 1,
        irn: find(SAMPLE, "\\\"Irn\\\":\\\"") + 10,
    }
}

#[test]
fn reads_the_nic_sample_fields() {
    let f = parse_invoice(buffer(SAMPLE), sample_positions());
    assert(f.gstin == "37ARZPT4384Q1MT".as_bytes());
    assert(f.paise == 200);
    assert(f.irn[0] == 0xd9);
    assert(f.irn[1] == 0x47);
    assert(f.irn[31] == 0x17);
}

#[test(should_fail_with = "wrong field")]
fn rejects_a_position_that_is_not_the_gstin_key() {
    let mut p = sample_positions();
    p.gstin = p.gstin + 40; // BuyerGstin value
    let _ = parse_invoice(buffer(SAMPLE), p);
}

#[test(should_fail_with = "wrong field")]
fn rejects_a_position_that_is_not_the_irn_key() {
    let mut p = sample_positions();
    p.irn = p.irn + 1;
    let _ = parse_invoice(buffer(SAMPLE), p);
}

global SAMPLE_DEC: str<338> = "{\"iss\":\"NIC\",\"data\":\"{\\\"SellerGstin\\\":\\\"37ARZPT4384Q1MT\\\",\\\"BuyerGstin\\\":\\\"29AWGPV7107B1Z1\\\",\\\"DocNo\\\":\\\"Test-00df1\\\",\\\"DocTyp\\\":\\\"INV\\\",\\\"DocDt\\\":\\\"14/07/2025\\\",\\\"TotInvVal\\\":1234.50,\\\"ItemCnt\\\":1,\\\"MainHsnCode\\\":\\\"010190\\\",\\\"Irn\\\":\\\"d9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17\\\",\\\"IrnDt\\\":\\\"2025-07-14 12:44:00\\\"}\"}";

fn dec_positions(len: u32) -> Positions {
    let mut p = sample_positions();
    p.value = find(SAMPLE_DEC, "\\\"TotInvVal\\\":") + 14;
    p.gstin = find(SAMPLE_DEC, "\\\"SellerGstin\\\":\\\"") + 18;
    p.doctyp = find(SAMPLE_DEC, "\\\"DocTyp\\\":\\\"") + 13;
    p.irn = find(SAMPLE_DEC, "\\\"Irn\\\":\\\"") + 10;
    p.value_len = len;
    p
}

#[test]
fn reads_a_decimal_value_in_paise() {
    let f = parse_invoice(buffer(SAMPLE_DEC), dec_positions(7));
    assert(f.paise == 123450);
}

#[test(should_fail_with = "bad value")]
fn rejects_a_value_length_that_swallows_the_comma() {
    let _ = parse_invoice(buffer(SAMPLE_DEC), dec_positions(8));
}

#[test(should_fail_with = "bad value")]
fn rejects_a_value_length_that_stops_inside_the_number() {
    let _ = parse_invoice(buffer(SAMPLE_DEC), dec_positions(6));
}

#[test(should_fail_with = "bad value")]
fn rejects_three_decimals() {
    let mut b = buffer(SAMPLE_DEC);
    let mut p = dec_positions(8);
    b[p.value + 5] = 51;
    b[p.value + 6] = 53; // 1234.350 with the comma moved one place right
    b[p.value + 7] = 48;
    b[p.value + 8] = 44;
    p.value_len = 8;
    let _ = parse_invoice(b, p);
}

#[test(should_fail_with = "bad value")]
fn rejects_a_non_digit_in_the_value() {
    let mut b = buffer(SAMPLE);
    let p = sample_positions();
    b[p.value] = 120; // x
    let _ = parse_invoice(b, p);
}

#[test(should_fail_with = "bad value")]
fn rejects_a_zero_value() {
    let mut b = buffer(SAMPLE);
    let p = sample_positions();
    b[p.value] = 48;
    let _ = parse_invoice(b, p);
}

#[test(should_fail_with = "not an invoice")]
fn rejects_a_credit_note() {
    let mut b = buffer(SAMPLE);
    let p = sample_positions();
    b[p.doctyp] = 67; // C
    b[p.doctyp + 1] = 82; // R
    b[p.doctyp + 2] = 78; // N
    let _ = parse_invoice(b, p);
}

#[test(should_fail_with = "bad gstin")]
fn rejects_a_lowercase_gstin() {
    let mut b = buffer(SAMPLE);
    let p = sample_positions();
    b[p.gstin + 3] = 97;
    let _ = parse_invoice(b, p);
}

#[test(should_fail_with = "bad irn")]
fn rejects_a_non_hex_irn() {
    let mut b = buffer(SAMPLE);
    let p = sample_positions();
    b[p.irn + 5] = 103; // g
    let _ = parse_invoice(b, p);
}

#[test]
fn reads_an_uppercase_irn_as_the_same_bytes() {
    let mut b = buffer(SAMPLE);
    let p = sample_positions();
    b[p.irn] = 68; // D
    let f = parse_invoice(b, p);
    assert(f.irn[0] == 0xd9);
}

#[test(should_fail_with = "wrong field")]
fn rejects_a_marker_hidden_inside_another_value() {
    // The marker text exists but is preceded by a backslash, as it would be inside a value.
    let mut b = buffer(SAMPLE);
    let p = sample_positions();
    b[p.doctyp - 13 - 1] = 92;
    let _ = parse_invoice(b, p);
}
