import { readCrmData, writeCrmData } from "./_db.js";
import { json, readBody, requireAdmin } from "./_admin-auth.js";

export default async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  try {
    if (req.method === "GET") {
      return json(res, 200, { data: await readCrmData() });
    }
    if (req.method === "PUT") {
      const body = await readBody(req);
      if (!body.data || typeof body.data !== "object") return json(res, 400, { error: "Invalid CRM data" });
      const data = await writeCrmData(body.data, session.email, body.action || "Saved CRM data");
      return json(res, 200, { data });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "CRM data request failed" });
  }
}
