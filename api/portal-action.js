import { randomUUID } from "node:crypto";
import { authenticatePortalClient, json, readBody } from "./_portal-store.js";
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

    const data = await readCrmData();
    const client = data.clients.find((item) => item.id === record.portalId);
    if (!client) return json(res, 404, { error: "Client profile not found." });
    applyPortalAction(data, client, type, safePayload);
    await writeCrmData(data, record.email, `Client portal ${type.replaceAll("_", " ")} for ${record.clientName}`);
    return json(res, 200, { ok: true, applied: true });
  } catch (error) {
    return json(res, 400, { error: error.message || "Portal action failed." });
  }
}

function applyPortalAction(data, client, type, payload) {
  if (type === "meeting_request") {
    const meeting = normalizeRecord("meeting", {
      clientId: client.id,
      type: payload.meetingType || "Strategy Meeting",
      title: `${payload.meetingType || "Strategy Meeting"} request`,
      datetime: payload.datetime,
      status: "Proposed",
      proposedBy: "Client",
      notes: payload.notes || "",
    });
    data.meetings.push(meeting);
    syncWorkflowFlags(data, "meeting", meeting);
    return;
  }
  if (type === "meeting_confirm") {
    const meeting = data.meetings.find((item) => item.id === payload.meetingId || (
      item.clientId === client.id && item.type === payload.meetingType && item.datetime === payload.datetime
    ));
    if (meeting) {
      meeting.status = "Confirmed";
      syncWorkflowFlags(data, "meeting", meeting);
    }
    return;
  }
  if (type === "questionnaire_update") {
    const existing = data.questionnaires.find((item) => item.clientId === client.id);
    const next = normalizeRecord("questionnaire", { clientId: client.id, ...payload }, existing || {});
    if (existing) Object.assign(existing, next);
    else data.questionnaires.push(next);
    syncWorkflowFlags(data, "questionnaire", next);
    return;
  }
  if (type === "support_request") {
    data.tasks.push(normalizeRecord("task", {
      clientId: client.id,
      title: payload.title || "Client support request",
      dueDate: payload.dueDate || new Date().toISOString().slice(0, 10),
      priority: payload.priority || "Normal",
      source: "client_portal_support",
      category: "Support",
    }));
    return;
  }
  if (type === "onboarding_step") {
    const checklist = ensureOnboarding(data, client.id);
    checklist[payload.step] = Boolean(payload.done);
    return;
  }
  if (type === "brand_update") {
    Object.assign(client, normalizeBrandUpdate(payload));
  }
}

function id() {
  return randomUUID();
}

function normalizeRecord(type, values, existing = {}) {
  const base = { ...existing, ...values };
  if (!base.id) base.id = id();
  if (type === "questionnaire") base.budgetRange = Number(base.budgetRange || 0);
  if (type === "meeting") {
    base.status ||= "Proposed";
    base.proposedBy ||= "Client";
  }
  if (type === "task") base.done = Boolean(existing.done);
  if (type === "task") base.createdAt ||= new Date().toISOString();
  return base;
}

function ensureOnboarding(data, clientId) {
  let checklist = data.onboarding.find((item) => item.clientId === clientId);
  if (!checklist) {
    checklist = normalizeRecord("onboarding", { clientId });
    data.onboarding.push(checklist);
  }
  return checklist;
}

function syncWorkflowFlags(data, type, record) {
  if (!record.clientId) return;
  if (type === "questionnaire") ensureOnboarding(data, record.clientId).questionnaireCompleted = true;
  if (type === "meeting") {
    const checklist = ensureOnboarding(data, record.clientId);
    if (record.type === "Welcome Call") {
      checklist.welcomeCallScheduled = record.status !== "Canceled";
      checklist.welcomeCallDate = record.datetime;
      checklist.welcomeCallProposedBy = record.proposedBy || "Client";
      checklist.welcomeCallConfirmed = record.status === "Confirmed" || record.status === "Completed";
    }
    if (record.type === "Strategy Meeting") {
      checklist.strategyMeetingDate = record.datetime;
      checklist.strategyMeetingProposedBy = record.proposedBy || "Client";
      checklist.strategyMeetingConfirmed = record.status === "Confirmed" || record.status === "Completed";
      checklist.strategyMeetingHeld = record.status === "Completed";
    }
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
