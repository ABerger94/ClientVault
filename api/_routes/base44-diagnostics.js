import { json, requireAdmin } from "../_admin-auth.js";
import { base44Diagnostics } from "../_base44.js";

export default async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  return json(res, 200, { base44: base44Diagnostics() });
}
