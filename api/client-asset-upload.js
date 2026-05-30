import { put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { json, readBody, requireAdmin } from "./_admin-auth.js";

const MAX_ASSET_BYTES = 15 * 1024 * 1024;

export default async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    const body = await readBody(req);
    const dataUrl = String(body.dataUrl || "");
    const [, encoded = ""] = dataUrl.split(",");
    if (!encoded) return json(res, 400, { error: "Missing file data" });
    const buffer = Buffer.from(encoded, "base64");
    if (!buffer.length) return json(res, 400, { error: "File is empty" });
    if (buffer.length > MAX_ASSET_BYTES) return json(res, 413, { error: "File must be 15 MB or smaller" });

    const filename = safeFilename(body.filename || "client-asset");
    const clientId = safePathSegment(body.clientId || "unassigned");
    const pathname = `crm/assets/${clientId}/${Date.now()}-${randomBytes(6).toString("hex")}-${filename}`;
    const result = await put(pathname, buffer, {
      access: "public",
      contentType: body.contentType || "application/octet-stream",
      addRandomSuffix: false,
    });

    return json(res, 200, {
      url: result.url,
      downloadUrl: result.downloadUrl || result.url,
      pathname: result.pathname,
      contentType: body.contentType || "application/octet-stream",
      size: buffer.length,
    });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Asset upload failed" });
  }
}

function safeFilename(value) {
  return String(value || "client-asset")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120);
}

function safePathSegment(value) {
  return String(value || "unassigned").replace(/[^a-z0-9_-]/gi, "-").slice(0, 80);
}
