import adminLogin from "./_routes/admin-login.js";
import adminLogout from "./_routes/admin-logout.js";
import adminSession from "./_routes/admin-session.js";
import assetFile from "./_routes/asset-file.js";
import clientAssetUpload from "./_routes/client-asset-upload.js";
import crmData from "./_routes/crm-data.js";
import fathomWebhook from "./_routes/fathom-webhook.js";
import health from "./_routes/health.js";
import importFathomMeetings from "./_routes/import-fathom-meetings.js";
import meetingAi from "./_routes/meeting-ai.js";
import meetingChat from "./_routes/meeting-chat.js";
import portalAction from "./_routes/portal-action.js";
import portalAssetUpload from "./_routes/portal-asset-upload.js";
import portalLogin from "./_routes/portal-login.js";
import portalPublish from "./_routes/portal-publish.js";
import portalSync from "./_routes/portal-sync.js";
import { json } from "./_admin-auth.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

const handlers = {
  "admin-login": adminLogin,
  "admin-logout": adminLogout,
  "admin-session": adminSession,
  "asset-file": assetFile,
  "client-asset-upload": clientAssetUpload,
  "crm-data": crmData,
  "fathom-webhook": fathomWebhook,
  health,
  "import-fathom-meetings": importFathomMeetings,
  "meeting-ai": meetingAi,
  "meeting-chat": meetingChat,
  "portal-action": portalAction,
  "portal-asset-upload": portalAssetUpload,
  "portal-login": portalLogin,
  "portal-publish": portalPublish,
  "portal-sync": portalSync,
};

export default async function handler(req, res) {
  const route = routeName(req);
  const routeHandler = handlers[route];
  if (!routeHandler) return json(res, 404, { error: "API route not found" });
  return await routeHandler(req, res);
}

function routeName(req) {
  const queryRoute = req.query?.route;
  if (Array.isArray(queryRoute)) return queryRoute.join("/");
  if (queryRoute) return String(queryRoute);
  const url = new URL(req.url || "", "http://localhost");
  return url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
}
