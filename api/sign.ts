// Vercel function: POST /api/sign. All the logic and the policy live in _signer.ts.
// The limiter lives in this instance's memory, so it slows a flood from one caller and caps the total here; it is not a login.
import { handleSign, RateLimiter } from "./_signer.ts";

const limiter = new RateLimiter({ perCaller: 30, total: 600, windowMs: 60_000 });

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only." });
    return;
  }
  const caller = String(req.headers?.["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim();
  if (!limiter.allow(caller)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Too many requests; wait a minute." });
    return;
  }
  const declared = Number(req.headers?.["content-length"] ?? 0);
  if (declared > 1024 * 1024) {
    res.status(413).json({ error: "That request is larger than the demo accepts." });
    return;
  }
  const r = await handleSign(req.body, process.env);
  res.status(r.status).json(r.body);
}
