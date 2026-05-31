import { get } from "@vercel/blob";
import { Readable } from "node:stream";
import { getSession, json, readBody } from "./_admin-auth.js";
import { authenticatePortalClient } from "./_portal-store.js";

export default async function handler(req, res) {
  try {
    const request = await parseRequest(req);
    if (!request.pathname) return json(res, 400, { error: "Missing asset pathname." });
    const auth = await authorizeAssetRequest(req, res, request);
    if (!auth) return;

    const result = await get(request.pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return json(res, 404, { error: "Asset not found." });

    const filename = safeDownloadName(request.filename || request.pathname.split("/").pop() || "client-asset");
    const contentType = result.blob.contentType || "application/octet-stream";
    res.statusCode = 200;
    res.setHeader("content-type", contentType);
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("content-length", String(result.blob.size));
    res.setHeader("content-disposition", `${dispositionFor(contentType)}; filename="${filename}"`);
    Readable.fromWeb(result.stream).pipe(res);
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Could not read asset." });
  }
}

async function parseRequest(req) {
  if (req.method === "GET") {
    const url = new URL(req.url || "", "http://localhost");
    return {
      pathname: url.searchParams.get("pathname") || "",
      filename: url.searchParams.get("filename") || "",
    };
  }
  if (req.method === "POST") return await readBody(req);
  throw Object.assign(new Error("Method not allowed"), { statusCode: 405 });
}

async function authorizeAssetRequest(req, res, request) {
  const admin = getSession(req);
  if (admin) return { type: "admin" };

  if (req.method !== "POST") {
    json(res, 401, { error: "Authentication required." });
    return null;
  }

  const record = await authenticatePortalClient(request.email, request.accessCode);
  if (!record) {
    json(res, 401, { error: "Invalid email or access code." });
    return null;
  }

  if (!assetPathBelongsToPortal(request.pathname, record.portalId)) {
    json(res, 403, { error: "This asset is not available for this portal." });
    return null;
  }
  return { type: "portal", record };
}

function assetPathBelongsToPortal(pathname, portalId) {
  const safePortalId = safePathSegment(portalId);
  return pathname.startsWith(`portal/assets/${safePortalId}/`) || pathname.startsWith(`crm/assets/${safePortalId}/`);
}

function assetFileUrl(pathname, filename = "") {
  const params = new URLSearchParams({ pathname });
  if (filename) params.set("filename", filename);
  return `/api/asset-file?${params.toString()}`;
}

function dispositionFor(contentType) {
  return /^(image|text)\//.test(contentType) || contentType === "application/pdf" ? "inline" : "attachment";
}

function safeDownloadName(value) {
  return String(value || "client-asset")
    .replace(/[/\\?%*:|"<>\r\n]/g, "-")
    .slice(0, 160);
}

function safePathSegment(value) {
  return String(value || "unassigned").replace(/[^a-z0-9_-]/gi, "-").slice(0, 80);
}

export { assetFileUrl };
