import { appendAudit, readCrmData } from "./_db.js";
import { json, readBody, setSessionCookie, validateLogin } from "./_admin-auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const { email, password } = await readBody(req);
    const result = validateLogin(email, password);
    if (!result.ok) {
      return json(res, result.reason === "not_configured" ? 503 : 401, {
        error: result.reason === "not_configured"
          ? "Admin auth is not configured. Set CLIENTVAULT_ADMIN_EMAIL, CLIENTVAULT_ADMIN_PASSWORD, CLIENTVAULT_SESSION_SECRET, and POSTGRES_URL in Vercel."
          : "Invalid email or password",
      });
    }
    setSessionCookie(res, String(email).trim().toLowerCase());
    const data = await readCrmData();
    await appendAudit(String(email).trim().toLowerCase(), "Admin logged in");
    return json(res, 200, { data });
  } catch (error) {
    return json(res, 500, { error: error.message || "Login failed" });
  }
}
