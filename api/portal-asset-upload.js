import { put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { authenticatePortalClient, json } from "./_portal-store.js";
import { readCrmData, writeCrmData } from "./_db.js";

const MAX_ASSET_BYTES = 15 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const body = await readMultipartUpload(req, req.headers["content-type"] || "");
    const record = await authenticatePortalClient(body.email, body.accessCode);
    if (!record) return json(res, 401, { error: "Invalid email or access code." });
    if (!body.buffer.length) return json(res, 400, { error: "File is empty" });
    if (body.buffer.length > MAX_ASSET_BYTES) return json(res, 413, { error: "File must be 15 MB or smaller" });

    const pathname = `portal/assets/${safePathSegment(record.portalId)}/${Date.now()}-${randomBytes(6).toString("hex")}-${safeFilename(body.filename)}`;
    const result = await put(pathname, body.buffer, {
      access: "public",
      contentType: body.contentType || "application/octet-stream",
      addRandomSuffix: false,
    });
    const asset = {
      id: randomBytes(12).toString("hex"),
      category: body.category || "Reference",
      assetLabel: body.assetLabel || body.category || "Reference",
      name: body.displayName || body.filename,
      displayName: body.displayName || body.filename,
      originalName: body.filename,
      type: body.contentType || "application/octet-stream",
      size: body.buffer.length,
      url: result.url,
      downloadUrl: result.downloadUrl || result.url,
      pathname: result.pathname,
      notes: body.notes || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      uploadedBy: "Client",
    };

    const data = await readCrmData();
    const client = data.clients.find((item) => item.id === record.portalId);
    if (!client) return json(res, 404, { error: "Client profile not found." });
    data.clientAssets ||= [];
    data.clientAssets.push({ ...asset, clientId: record.portalId });
    await writeCrmData(data, record.email, `Client uploaded asset for ${record.clientName}`);

    return json(res, 200, { ok: true, applied: true, asset });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Portal asset upload failed." });
  }
}

async function readMultipartUpload(req, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw Object.assign(new Error("Missing upload boundary"), { statusCode: 400 });
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const fields = {};
  let file = null;
  const parts = body.toString("binary").split(`--${boundary}`).slice(1, -1);
  parts.forEach((part) => {
    const cleaned = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const splitIndex = cleaned.indexOf("\r\n\r\n");
    if (splitIndex < 0) return;
    const rawHeaders = cleaned.slice(0, splitIndex);
    const value = cleaned.slice(splitIndex + 4);
    const name = rawHeaders.match(/name="([^"]+)"/)?.[1];
    const filename = rawHeaders.match(/filename="([^"]*)"/)?.[1];
    const partType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1];
    if (!name) return;
    if (filename) file = { filename, contentType: partType, buffer: Buffer.from(value, "binary") };
    else fields[name] = Buffer.from(value, "binary").toString("utf8");
  });
  if (!file) throw Object.assign(new Error("Choose a file to upload."), { statusCode: 400 });
  return { ...fields, ...file };
}

function safeFilename(value) {
  return String(value || "client-asset").replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, "-").slice(0, 120);
}

function safePathSegment(value) {
  return String(value || "unassigned").replace(/[^a-z0-9_-]/gi, "-").slice(0, 80);
}
