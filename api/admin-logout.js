import { clearSessionCookie, json } from "./_admin-auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  clearSessionCookie(res);
  return json(res, 200, { ok: true });
}
