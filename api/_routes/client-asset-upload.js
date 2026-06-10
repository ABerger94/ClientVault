import { put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { json, readBody, requireAdmin } from "../_admin-auth.js";
import { assetFileUrl } from "./asset-file.js";

const MAX_ASSET_BYTES = 15 * 1024 * 1024;

export default async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
    const body = await readUploadBody(req);
    const buffer = body.buffer;
    if (!buffer.length) return json(res, 400, { error: "File is empty" });
    if (buffer.length > MAX_ASSET_BYTES) return json(res, 413, { error: "File must be 15 MB or smaller" });

    const filename = safeFilename(body.filename || "client-asset");
    const clientId = safePathSegment(body.clientId || "unassigned");
    const pathname = `crm/assets/${clientId}/${Date.now()}-${randomBytes(6).toString("hex")}-${filename}`;
    const result = await put(pathname, buffer, {
      access: "private",
      contentType: body.contentType || "application/octet-stream",
      addRandomSuffix: false,
    });
    const fileUrl = assetFileUrl(result.pathname, filename);

    return json(res, 200, {
      url: fileUrl,
      downloadUrl: fileUrl,
      pathname: result.pathname,
      contentType: body.contentType || "application/octet-stream",
      size: buffer.length,
    });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Asset upload failed" });
  }
}

async function readUploadBody(req) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) return await readMultipartUpload(req, contentType);
  const body = await readBody(req);
  const dataUrl = String(body.dataUrl || "");
  const [, encoded = ""] = dataUrl.split(",");
  return {
    clientId: body.clientId,
    filename: body.filename,
    contentType: body.contentType,
    buffer: encoded ? Buffer.from(encoded, "base64") : Buffer.alloc(0),
  };
}

async function readMultipartUpload(req, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    const error = new Error("Missing upload boundary");
    error.statusCode = 400;
    throw error;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const fields = {};
  let file = null;
  const boundaryText = `--${boundary}`;
  const parts = body.toString("binary").split(boundaryText).slice(1, -1);
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
    if (filename) {
      file = {
        filename,
        contentType: partType || "application/octet-stream",
        buffer: Buffer.from(value, "binary"),
      };
    } else {
      fields[name] = Buffer.from(value, "binary").toString("utf8");
    }
  });
  if (!file) {
    const error = new Error("Missing file");
    error.statusCode = 400;
    throw error;
  }
  return {
    clientId: fields.clientId,
    filename: file.filename,
    contentType: file.contentType,
    buffer: file.buffer,
  };
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
