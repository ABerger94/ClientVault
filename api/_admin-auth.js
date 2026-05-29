import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "clientvault_session";
const SESSION_MAX_AGE = 60 * 60 * 8;

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
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

function sessionSecret() {
  return process.env.CLIENTVAULT_SESSION_SECRET || process.env.PORTAL_ADMIN_SECRET || "";
}

function configuredAdmin() {
  return {
    email: String(process.env.CLIENTVAULT_ADMIN_EMAIL || "").trim().toLowerCase(),
    password: String(process.env.CLIENTVAULT_ADMIN_PASSWORD || ""),
  };
}

function safeTextEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(value) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function encodeSession(email) {
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    }),
  );
}

export function setSessionCookie(res, email) {
  const secure = process.env.VERCEL === "1" ? "; Secure" : "";
  res.setHeader("set-cookie", `${COOKIE_NAME}=${encodeSession(email)}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly${secure}; SameSite=Lax`);
}

export function clearSessionCookie(res) {
  const secure = process.env.VERCEL === "1" ? "; Secure" : "";
  res.setHeader("set-cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly${secure}; SameSite=Lax`);
}

export function validateLogin(email, password) {
  const admin = configuredAdmin();
  if (!admin.email || !admin.password || !sessionSecret()) return { ok: false, reason: "not_configured" };
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const ok = safeTextEqual(normalizedEmail, admin.email) && safeTextEqual(String(password || ""), admin.password);
  return { ok, reason: ok ? "" : "invalid" };
}

export function getSession(req) {
  if (!sessionSecret()) return null;
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[COOKIE_NAME];
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  if (!safeTextEqual(signature, sign(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed.email || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: "Authentication required" });
    return null;
  }
  return session;
}
