import { hasDatabase, readCrmData } from "./_db.js";
import { json } from "./_admin-auth.js";
import { readIndex } from "./_portal-store.js";

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function configuredAdmin() {
  return Boolean(
    process.env.CLIENTVAULT_ADMIN_EMAIL &&
      process.env.CLIENTVAULT_ADMIN_PASSWORD &&
      process.env.CLIENTVAULT_SESSION_SECRET,
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  const checks = {
    adminAuth: configuredAdmin(),
    sessionSecret: Boolean(process.env.CLIENTVAULT_SESSION_SECRET),
    portalAdminSecret: Boolean(process.env.PORTAL_ADMIN_SECRET),
    storage: hasDatabase() ? "postgres" : hasBlob() ? "blob" : "missing",
    publicUrl: Boolean(process.env.CLIENTVAULT_PUBLIC_URL),
  };

  const ok = checks.adminAuth && checks.sessionSecret && checks.portalAdminSecret && checks.storage !== "missing";

  if (!ok) {
    return json(res, 503, { ok: false, checks });
  }

  try {
    const data = await readCrmData();
    const index = await readIndex();
    return json(res, 200, {
      ok: true,
      checks,
      counts: {
        clients: data.clients.length,
        contacts: data.contacts.length,
        projects: data.projects.length,
        portalClients: index.clients.length,
      },
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      checks,
      error: error.message || "Health check failed",
    });
  }
}
