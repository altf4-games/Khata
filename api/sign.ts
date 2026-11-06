// Vercel function: POST /api/sign. All the logic and the policy live in _signer.ts.
import { handleSign } from "./_signer.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only." });
    return;
  }
  const r = await handleSign(req.body, process.env);
  res.status(r.status).json(r.body);
}
