import { appendUpdate, authenticatePortalClient, json, readBody } from "./_portal-store.js";
import { readCrmData, writeCrmData } from "./_db.js";

const ALLOWED_TYPES = new Set([
  "meeting_request",
  "meeting_confirm",
  "questionnaire_update",
  "support_request",
  "onboarding_step",
  "brand_update",
]);

const ALLOWED_STEPS = new Set([
  "welcomeEmailSent",
  "portalAccessGranted",
  "welcomeCallScheduled",
  "brandAssetsCollected",
  "businessGoalsDocumented",
  "questionnaireCompleted",
  "strategyMeetingHeld",
  "projectPlanCreated",
  "communicationChannelsSet",
  "firstProjectCreated",
  "initialInvoiceSent",
  "retainerAgreementSigned",
]);

function text(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function cleanPayload(type, payload = {}) {
  if (type === "meeting_request") {
    if (!payload.datetime) throw new Error("Meeting date and time are required.");
    return {
      meetingType: text(payload.meetingType, 80) || "Strategy Meeting",
      datetime: text(payload.datetime, 80),
      notes: text(payload.notes, 2000),
    };
  }
  if (type === "meeting_confirm") {
    return {
      meetingId: text(payload.meetingId, 100),
      meetingType: text(payload.meetingType, 80),
      datetime: text(payload.datetime, 80),
    };
  }
  if (type === "questionnaire_update") {
    return {
      primaryGoal: text(payload.primaryGoal, 300),
      timeline: text(payload.timeline, 300),
      budgetRange: text(payload.budgetRange, 100),
      designStyle: text(payload.designStyle, 300),
      targetAudience: text(payload.targetAudience, 1000),
      mainServices: text(payload.mainServices, 1000),
      uniqueValue: text(payload.uniqueValue, 1000),
      additionalNotes: text(payload.additionalNotes, 2000),
    };
  }
  if (type === "support_request") {
    if (!payload.title) throw new Error("Request title is required.");
    return {
      title: text(payload.title, 200),
      priority: ["Low", "Normal", "High"].includes(payload.priority) ? payload.priority : "Normal",
      dueDate: text(payload.dueDate, 40),
      notes: text(payload.notes, 2000),
    };
  }
  if (type === "onboarding_step") {
    if (!ALLOWED_STEPS.has(payload.step)) throw new Error("Unsupported onboarding step.");
    return { step: payload.step, done: Boolean(payload.done) };
  }
  if (type === "brand_update") {
    return {
      brandPrimary: text(payload.brandPrimary, 20),
      brandPrimaryLabel: text(payload.brandPrimaryLabel, 80) || "Primary",
      brandSecondary: text(payload.brandSecondary, 20),
      brandSecondaryLabel: text(payload.brandSecondaryLabel, 80) || "Secondary",
      brandAccent: text(payload.brandAccent, 20),
      brandAccentLabel: text(payload.brandAccentLabel, 80) || "Accent",
      brandNeutral: text(payload.brandNeutral, 20),
      brandNeutralLabel: text(payload.brandNeutralLabel, 80) || "Neutral",
      brandColors: Array.isArray(payload.brandColors)
        ? payload.brandColors.slice(0, 12).map((entry) => ({
            color: text(entry.color, 20),
            label: text(entry.label, 80) || "Brand color",
          }))
        : [],
    };
  }
  return {};
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  try {
    const { email, accessCode, type, payload } = await readBody(req);
    const record = await authenticatePortalClient(email, accessCode);
    if (!record) return json(res, 401, { error: "Invalid email or access code." });
    if (!ALLOWED_TYPES.has(type)) return json(res, 400, { error: "Unsupported portal action." });
    const safePayload = cleanPayload(type, payload);

    if (type === "brand_update") {
      const data = await readCrmData();
      const client = data.clients.find((item) => item.id === record.portalId);
      if (!client) return json(res, 404, { error: "Client profile not found." });
      Object.assign(client, normalizeBrandUpdate(safePayload));
      await writeCrmData(data, record.email, `Client updated brand colors for ${record.clientName}`);
      return json(res, 200, { ok: true, applied: true });
    }

    await appendUpdate({
      portalId: record.portalId,
      clientName: record.clientName,
      email: record.email,
      type,
      payload: safePayload,
      status: "pending",
    });

    return json(res, 200, { ok: true });
  } catch (error) {
    return json(res, 400, { error: error.message || "Portal action failed." });
  }
}

function validColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "";
}

function normalizeBrandUpdate(payload) {
  return {
    brandPrimary: validColor(payload.brandPrimary),
    brandPrimaryLabel: payload.brandPrimaryLabel || "Primary",
    brandSecondary: validColor(payload.brandSecondary),
    brandSecondaryLabel: payload.brandSecondaryLabel || "Secondary",
    brandAccent: validColor(payload.brandAccent),
    brandAccentLabel: payload.brandAccentLabel || "Accent",
    brandNeutral: validColor(payload.brandNeutral),
    brandNeutralLabel: payload.brandNeutralLabel || "Neutral",
    brandColors: payload.brandColors.map((entry) => ({
      color: validColor(entry.color),
      label: entry.label || "Brand color",
    })).filter((entry) => entry.color),
  };
}
