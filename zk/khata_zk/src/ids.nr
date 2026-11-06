// The identifiers the contract stores, computed the same way as NicInvoice.sol so the zero-knowledge path and the plain path
// share one nullifier per IRN and one hash per seller GSTIN.

/// keccak256("KHATA_IRN_V1" ++ irn), or with the demo prefix for invoices signed by a labelled demo key.
pub fn nullifier(irn: [u8; 32], demo: bool) -> [u8; 32] {
    let real = "KHATA_IRN_V1".as_bytes();
    let demo_prefix = "KHATA_DEMO_IRN_V1".as_bytes();
    let mut msg = [0 as u8; 49];
    if demo {
        for i in 0..17 {
            msg[i] = demo_prefix[i];
        }
        for i in 0..32 {
            msg[17 + i] = irn[i];
        }
        keccak256::keccak256(msg, 49)
    } else {
        for i in 0..12 {
            msg[i] = real[i];
        }
        for i in 0..32 {
            msg[12 + i] = irn[i];
        }
        keccak256::keccak256(msg, 44)
    }
}

/// keccak256 of the GSTIN text.
pub fn gstin_hash(gstin: [u8; 15]) -> [u8; 32] {
    keccak256::keccak256(gstin, 15)
}

/// Splits 32 bytes into two 128-bit numbers (high half first), the form the public inputs take.
pub fn split(h: [u8; 32]) -> (Field, Field) {
    let mut hi: Field = 0;
    let mut lo: Field = 0;
    for i in 0..16 {
        hi = hi * 256 + h[i] as Field;
        lo = lo * 256 + h[16 + i] as Field;
    }
    (hi, lo)
}

fn sample_irn() -> [u8; 32] {
    let hex = "d9476807f5496dea9fc65c6a954887db156022ba4b0d17a3687d43576beb8e17".as_bytes();
    let mut out = [0 as u8; 32];
    for i in 0..32 {
        let hi = if hex[2 * i] <= 57 { hex[2 * i] - 48 } else { hex[2 * i] - 87 };
        let lo = if hex[2 * i + 1] <= 57 { hex[2 * i + 1] - 48 } else { hex[2 * i + 1] - 87 };
        out[i] = hi * 16 + lo;
    }
    out
}

#[test]
fn nullifier_matches_solidity_for_a_real_invoice() {
    // cast keccak of "KHATA_IRN_V1" ++ irn, computed independently of this code
    let (hi, lo) = split(nullifier(sample_irn(), false));
    assert(hi == 0x1cf2ba400656c20ef1eea06151897506);
    assert(lo == 0x8eb93aae07cdbbfadf5065ff46f69251);
}

#[test]
fn demo_invoices_use_their_own_namespace() {
    let (hi, lo) = split(nullifier(sample_irn(), true));
    assert(hi == 0x92c0d63cba794a5391d31139cbf65e78);
    assert(lo == 0xcfc1d8d28333e7977582892a248c7cd5);
    let (rhi, _) = split(nullifier(sample_irn(), false));
    assert(hi != rhi);
}

#[test]
fn gstin_hash_matches_solidity() {
    let (hi, lo) = split(gstin_hash("37ARZPT4384Q1MT".as_bytes()));
    assert(hi == 0x3fd5719c8c257a2d525e95cb9a52cd9d);
    assert(lo == 0xd41c8c6c0eed9ba7e9b33ccdad4fb82e);
}
