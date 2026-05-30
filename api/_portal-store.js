import { BlobNotFoundError, get, put } from "@vercel/blob";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hasDatabase, readKv, writeKv } from "./_db.js";

const INDEX_PATH = "portal/index.json";
const ADMIN_PATH = "portal/admin.json";
const UPDATES_PATH = "portal/updates.json";

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export async function readJson(path, fallback = null) {
  if (hasDatabase()) return await readKv(path, fallback);
  try {
    const result = await get(path, { access: "private", useCache: false });
    if (!result) return fallback;
    return await new Response(result.stream).json();
  } catch (error) {
    if (error instanceof BlobNotFoundError) return fallback;
    throw error;
  }
}

export async function writeJson(path, value) {
  if (hasDatabase()) {
    await writeKv(path, value);
    return;
  }
  await put(path, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Invalid JSON request body");
    error.statusCode = 400;
    throw error;
  }
}

export function hashSecret(secret, salt) {
  return createHash("sha256").update(`${salt}:${secret}`).digest("hex");
}

export function newSalt() {
  return randomBytes(16).toString("hex");
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function verifyAdminSecret(secret) {
  const configuredSecret = process.env.PORTAL_ADMIN_SECRET;
  if (configuredSecret) {
    return Boolean(secret) && String(secret) === configuredSecret;
  }
  const admin = await readJson(ADMIN_PATH);
  if (!admin) {
    if (!secret || secret.length < 12) return false;
    const salt = newSalt();
    await writeJson(ADMIN_PATH, {
      salt,
      hash: hashSecret(secret, salt),
      createdAt: new Date().toISOString(),
    });
    return true;
  }
  return Boolean(secret) && safeEqual(hashSecret(secret, admin.salt), admin.hash);
}

export async function readIndex() {
  return await readJson(INDEX_PATH, { clients: [] });
}

export async function writeIndex(index) {
  await writeJson(INDEX_PATH, index);
}

export function portalPath(portalId) {
  return `portal/clients/${portalId}.json`;
}

export async function authenticatePortalClient(email, accessCode) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const index = await readIndex();
  const record = index.clients.find((item) => item.email === normalizedEmail);
  if (!record || !safeEqual(hashSecret(String(accessCode || ""), record.salt), record.accessHash)) {
    return null;
  }
  return record;
}

export async function readUpdates() {
  return await readJson(UPDATES_PATH, { updates: [] });
}

export async function writeUpdates(updates) {
  await writeJson(UPDATES_PATH, updates);
}

export async function appendUpdate(update) {
  const updates = await readUpdates();
  updates.updates.push({
    id: randomBytes(12).toString("hex"),
    createdAt: new Date().toISOString(),
    ...update,
  });
  await writeUpdates(updates);
  return updates;
}
