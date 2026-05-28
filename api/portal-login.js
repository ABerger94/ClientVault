import { authenticatePortalClient, json, portalPath, readBody, readJson } from "./_portal-store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const { email, accessCode } = await readBody(req);
    const record = await authenticatePortalClient(email, accessCode);
    if (!record) {
      return json(res, 401, { error: "Invalid email or access code." });
    }

    const snapshot = await readJson(portalPath(record.portalId));
    if (!snapshot) return json(res, 404, { error: "Portal data not found." });

    return json(res, 200, {
      ok: true,
      portal: snapshot,
    });
  } catch (error) {
    return json(res, 500, { error: "Portal login failed.", detail: error.message });
  }
}
