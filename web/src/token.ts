// The QR text a visitor gives us, made into the token the contract reads: whitespace from a paste removed, a token
// wrapped in a link or other text taken out, and anything larger than the contract accepts refused here.

/** The contract refuses tokens over this many bytes (NicJwt.MAX_TOKEN_BYTES). */
export const MAX_TOKEN_BYTES = 2048;

export type TokenInput = { token: string } | { token: ""; tooLarge: true };

export function normalizeToken(text: string): TokenInput {
  const compact = text.replace(/\s+/g, "");
  // a signed JWT is three base64url parts; if the text holds one inside something else (a link, a label), take the longest
  const found = compact.match(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g);
  const token = found && found.join("") !== compact ? found.sort((a, b) => b.length - a.length)[0] : compact;
  if (token.length > MAX_TOKEN_BYTES) return { token: "", tooLarge: true };
  return { token };
}
