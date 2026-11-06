// Proves, without revealing the invoice, that a NIC (or labelled demo IRP) key signed an e-invoice, and outputs only what the
// registry needs to bind it: the nullifier of its IRN, the hash of the seller GSTIN, and the value in paise. The prover's wallet
// address is a public input, so a proof cannot be replayed by someone else.
//
// What this circuit does not check, so that the on-chain plain path stays the stricter one: DocNo, DocDt and IrnDt formats,
// and the optional fields. It reads SellerGstin, DocTyp, TotInvVal and Irn only.
mod parse;
mod ids;

use base64::BASE64_URL_DECODER;
use jwt::JWT;
use parse::{parse_invoice, Positions};

/// Longest signed text (base64url header, a dot, base64url payload) the circuit accepts. The NIC sample is 594.
global MAX_SIGNED: u32 = 704;
global MAX_PAYLOAD: u32 = 528; // MAX_SIGNED / 4 * 3

fn main(
    data: BoundedVec<u8, MAX_SIGNED>,
    payload_start: u32,
    modulus: pub [u128; 18],
    redc: [u128; 18],
    signature: [u128; 18],
    pos: Positions,
    owner: pub Field,
    demo: pub bool,
) -> pub (Field, Field, Field, Field, u64) {
    // 1. The government key signed exactly these bytes. The modulus is public, so the contract checks it is a registered key.
    let jwt = JWT::init(data, 0, modulus, redc, signature);
    jwt.verify();

    // 2. The payload starts right after the one dot, so the prover cannot decode from a shifted position.
    assert(payload_start >= 1, "bad payload start");
    assert(payload_start < data.len(), "bad payload start");
    for i in 0..MAX_SIGNED {
        if i < data.len() {
            assert((data.storage()[i] == 46) == (i == payload_start - 1), "the signed text must hold exactly one dot");
        }
    }

    // 3. Decode the payload.
    let mut rotated = [0 as u8; MAX_SIGNED];
    for i in 0..MAX_SIGNED {
        rotated[i] = data.storage()[(i + payload_start) % data.len()];
    }
    let b64: BoundedVec<u8, MAX_SIGNED> = BoundedVec::from_parts(rotated, data.len() - payload_start);
    let decoded: BoundedVec<u8, MAX_PAYLOAD> = BASE64_URL_DECODER::decode_var(b64);
    let payload = decoded.storage();

    // 4. The payload is {"iss":"NIC","data":"{ ... }"}: the issuer text and the start of the escaped inner document.
    let head = "{\"iss\":\"NIC\",\"data\":\"{".as_bytes();
    for i in 0..head.len() {
        assert(payload[i] == head[i], "not a NIC payload");
    }

    // 5. Read the four fields the registry needs.
    let f = parse_invoice(payload, pos);

    let (n_hi, n_lo) = ids::split(ids::nullifier(f.irn, demo));
    let (g_hi, g_lo) = ids::split(ids::gstin_hash(f.gstin));
    // `owner` is only bound into the proof through being a public input
    assert(owner == owner);
    (n_hi, n_lo, g_hi, g_lo, f.paise)
}
