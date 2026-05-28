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

const DEFAULT_FROM = "ClientVault <onboarding@resend.dev>";

function absolutePortalUrl(req) {
  const configured = process.env.CLIENTVAULT_PUBLIC_URL;
  if (configured) return `${configured.replace(/\/$/, "")}/portal`;
  const host = req.headers["x-forwarded-host"] || req.headers.host || "clientvaultcrm.vercel.app";
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}/portal`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function sendPortalInvite({ to, clientName, accessCode, portalUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "Resend is not configured." };
  }

  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const supportEmail = process.env.CLIENTVAULT_SUPPORT_EMAIL || process.env.CLIENTVAULT_ADMIN_EMAIL || "";
  const subject = `Your ClientVault portal access for ${clientName}`;
  const text = [
    `Hi ${clientName},`,
    "",
    "Your ClientVault portal is ready.",
    "",
    `Portal: ${portalUrl}`,
    `Login email: ${to}`,
    `Access code: ${accessCode}`,
    "",
    "Use the portal to review onboarding, projects, meetings, and support requests.",
    supportEmail ? `Questions? Reply to ${supportEmail}.` : "",
  ].filter(Boolean).join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
      <h1 style="margin:0 0 12px">Your ClientVault portal is ready</h1>
      <p>Hi ${escapeHtml(clientName)},</p>
      <p>You can now access your ClientVault portal for onboarding, projects, meetings, and support requests.</p>
      <p><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none">Open ClientVault Portal</a></p>
      <p><strong>Login email:</strong> ${escapeHtml(to)}<br><strong>Access code:</strong> ${escapeHtml(accessCode)}</p>
      ${supportEmail ? `<p>Questions? Reply to ${escapeHtml(supportEmail)}.</p>` : ""}
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      html,
      reply_to: supportEmail || undefined,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { sent: false, reason: result.message || "Resend rejected the invite email." };
  }
  return { sent: true, id: result.id };
}

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

    const normalizedEmail = String(email).trim().toLowerCase();
    const withoutExisting = index.clients.filter((item) => item.portalId !== portalId);
    await writeIndex({ clients: [...withoutExisting, record] });
    await writeJson(portalPath(portalId), {
      ...snapshot,
      portalId,
      publishedAt: record.updatedAt,
    });
    const portalUrl = absolutePortalUrl(req);
    const invite = await sendPortalInvite({
      to: normalizedEmail,
      clientName: snapshot.client.name,
      accessCode: String(accessCode),
      portalUrl,
    });

    return json(res, 200, {
      ok: true,
      portalId,
      portalUrl: "/portal.html",
      invite,
      clientName: snapshot.client.name,
      updatedAt: record.updatedAt,
    });
  } catch (error) {
    return json(res, 500, { error: "Portal publish failed.", detail: error.message });
  }
}
