import { appendUpdate, authenticatePortalClient, json, readBody } from "./_portal-store.js";

const ALLOWED_TYPES = new Set([
  "meeting_request",
  "meeting_confirm",
  "questionnaire_update",
  "support_request",
  "onboarding_step",
]);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const { email, accessCode, type, payload } = await readBody(req);
    const record = await authenticatePortalClient(email, accessCode);
    if (!record) return json(res, 401, { error: "Invalid email or access code." });
    if (!ALLOWED_TYPES.has(type)) return json(res, 400, { error: "Unsupported portal action." });

    await appendUpdate({
      portalId: record.portalId,
      clientName: record.clientName,
      email: record.email,
      type,
      payload: payload || {},
      status: "pending",
    });

    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 500, { error: "Portal action failed.", detail: error.message });
  }
}
