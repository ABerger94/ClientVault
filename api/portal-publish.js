import {
  hashSecret,
  json,
  newSalt,
  portalPath,
  readBody,
  readIndex,
  verifyAdminSecret,
  writeIndex,
  writeJson,
} from "./_portal-store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const { adminSecret, email, accessCode, snapshot } = await readBody(req);
    if (!(await verifyAdminSecret(String(adminSecret || "")))) {
      return json(res, 401, { error: "Invalid portal admin secret." });
    }
    if (!email || !String(email).includes("@")) {
      return json(res, 400, { error: "Client email is required." });
    }
    if (!accessCode || String(accessCode).length < 8) {
      return json(res, 400, { error: "Access code must be at least 8 characters." });
    }
    if (!snapshot?.client?.id || !snapshot?.client?.name) {
      return json(res, 400, { error: "Invalid client snapshot." });
    }

    const index = await readIndex();
    const portalId = snapshot.client.id;
    const salt = newSalt();
    const record = {
      portalId,
      email: String(email).trim().toLowerCase(),
      salt,
      accessHash: hashSecret(String(accessCode), salt),
      clientName: snapshot.client.name,
      updatedAt: new Date().toISOString(),
    };

    const withoutExisting = index.clients.filter((item) => item.portalId !== portalId);
    await writeIndex({ clients: [...withoutExisting, record] });
    await writeJson(portalPath(portalId), {
      ...snapshot,
      portalId,
      publishedAt: record.updatedAt,
    });

    return json(res, 200, {
      ok: true,
      portalId,
      portalUrl: "/portal.html",
      clientName: snapshot.client.name,
      updatedAt: record.updatedAt,
    });
  } catch (error) {
    return json(res, 500, { error: "Portal publish failed.", detail: error.message });
  }
}
