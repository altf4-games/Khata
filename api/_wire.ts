// JSON cannot carry bigint, so numbers that are bigint travel as {"$bigint": "123"} between the browser and the signer.
export const wire = {
  encode(v: unknown): any {
    if (typeof v === "bigint") return { $bigint: v.toString() };
    if (Array.isArray(v)) return v.map((x) => wire.encode(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wire.encode(x)]));
    return v;
  },
  decode(v: any): any {
    if (Array.isArray(v)) return v.map((x) => wire.decode(x));
    if (v && typeof v === "object") {
      if (typeof v.$bigint === "string" && /^-?\d+$/.test(v.$bigint) && Object.keys(v).length === 1) return BigInt(v.$bigint);
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, wire.decode(x)]));
    }
    return v;
  },
};
