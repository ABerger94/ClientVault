import { readCrmData } from "./_db.js";
import { getSession, json } from "./_admin-auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  const session = getSession(req);
  if (!session) return json(res, 401, { authenticated: false });
  try {
    return json(res, 200, { authenticated: true, email: session.email, data: await readCrmData() });
  } catch (error) {
    return json(res, 500, { error: error.message || "Could not load session" });
  }
}
