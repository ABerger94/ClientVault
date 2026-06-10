import { json, readBody, readUpdates, verifyAdminSecret, writeUpdates } from "../_portal-store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const { adminSecret, clearIds } = await readBody(req);
    if (!(await verifyAdminSecret(String(adminSecret || "")))) {
      return json(res, 401, { error: "Invalid portal admin secret." });
    }

    const updates = await readUpdates();
    if (Array.isArray(clearIds) && clearIds.length) {
      const clearSet = new Set(clearIds);
      const remaining = updates.updates.filter((item) => !clearSet.has(item.id));
      await writeUpdates({ updates: remaining });
      return json(res, 200, { ok: true, cleared: clearIds.length, updates: remaining });
    }

    return json(res, 200, { ok: true, updates: updates.updates });
  } catch (error) {
    return json(res, 500, { error: "Portal sync failed.", detail: error.message });
  }
}
