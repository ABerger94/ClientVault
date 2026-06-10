import { createClient } from "@base44/sdk";
import { randomUUID } from "node:crypto";

export function base44Client() {
  const appId = process.env.BASE44_APP_ID || "";
  if (!appId) {
    const error = new Error("BASE44_APP_ID is not configured");
    error.statusCode = 400;
    throw error;
  }
  return createClient({
    appId,
    token: process.env.BASE44_ACCESS_TOKEN || process.env.BASE44_TOKEN || "",
    serviceToken: process.env.BASE44_SERVICE_TOKEN || "",
    functionsVersion: process.env.BASE44_FUNCTIONS_VERSION || "",
    appBaseUrl: process.env.BASE44_APP_BASE_URL || "",
    serverUrl: base44ServerUrl(),
    requiresAuth: false,
  });
}

export function base44ServerUrl() {
  const value = String(process.env.BASE44_SERVER_URL || "https://base44.app").trim().replace(/\/$/, "");
  try {
    const url = new URL(value);
    if (url.pathname && url.pathname !== "/") return `${url.origin}${url.pathname.replace(/\/api\/?$/, "")}`;
    return url.origin;
  } catch {
    return "https://base44.app";
  }
}

export function base44Diagnostics() {
  const appId = process.env.BASE44_APP_ID || "";
  const serverUrl = base44ServerUrl();
  return {
    configured: Boolean(appId),
    appIdPresent: Boolean(appId),
    appIdPreview: appId ? `${appId.slice(0, 4)}...${appId.slice(-4)}` : "",
    serverUrl,
    appBaseUrlPresent: Boolean(process.env.BASE44_APP_BASE_URL),
    functionsVersionPresent: Boolean(process.env.BASE44_FUNCTIONS_VERSION),
    accessTokenPresent: Boolean(process.env.BASE44_ACCESS_TOKEN || process.env.BASE44_TOKEN),
    serviceTokenPresent: Boolean(process.env.BASE44_SERVICE_TOKEN),
    invokeLlmUrl: appId ? `${serverUrl}/api/apps/${appId}/integration-endpoints/Core/InvokeLLM` : "",
    importFathomFunctionUrl: appId ? `${serverUrl}/api/apps/${appId}/functions/importFathomMeetings` : "",
  };
}

export function base44ErrorMessage(error, operation = "Base44 request") {
  if ((error.status || error.statusCode) === 404) {
    const diagnostics = base44Diagnostics();
    return `${operation} returned 404. The SDK tried ${diagnostics.invokeLlmUrl || diagnostics.importFathomFunctionUrl || "a Base44 endpoint"}. Check that BASE44_SERVER_URL is the Base44 API host, BASE44_APP_ID is the app id, and the requested Base44 integration/function exists for that app.`;
  }
  return error.message || `${operation} failed`;
}

export function base44StorageMode() {
  return String(process.env.BASE44_STORAGE_MODE || "").toLowerCase() === "true";
}

export function base44MeetingToCrm(record = {}) {
  return {
    id: record.crmId || `base44-${record.id || randomUUID()}`,
    base44Id: record.id || "",
    clientId: record.clientId || "",
    type: record.type || "Review",
    title: record.title || "Base44 Meeting",
    datetime: toDatetimeLocal(record.date || record.datetime || record.created_date || new Date().toISOString()),
    platform: record.platform || "Other",
    attendees: Array.isArray(record.attendees) ? record.attendees.join(", ") : String(record.attendees || ""),
    agenda: record.agenda || "",
    status: mapStatus(record.status),
    proposedBy: record.proposedBy || "Agency",
    durationMinutes: Number(record.duration_minutes || record.durationMinutes || 60),
    transcript: record.transcript || "",
    summary: record.summary || "",
    keyDecisions: arrayToLines(record.key_decisions || record.keyDecisions),
    talkingPoints: arrayToLines(record.talking_points || record.talkingPoints),
    actionItems: normalizeActionItems(record.action_items || record.actionItems),
    followUpEmailDraft: record.follow_up_email_draft || record.followUpEmailDraft || "",
    recordingUrl: record.recording_url || record.recordingUrl || "",
    prepMaterial: record.prep_material || record.prepMaterial || "",
    aiProcessed: Boolean(record.ai_processed || record.aiProcessed || record.summary || record.transcript),
    notes: record.recording_url ? `Synced from Base44: ${record.recording_url}` : "Synced from Base44",
  };
}

export function crmMeetingToBase44(meeting = {}) {
  return {
    title: meeting.title || meeting.type || "Meeting",
    date: meeting.datetime || new Date().toISOString(),
    platform: meeting.platform || "Other",
    attendees: splitComma(meeting.attendees),
    agenda: meeting.agenda || meeting.notes || "",
    status: meeting.status === "Canceled" ? "Cancelled" : meeting.status || "Upcoming",
    duration_minutes: Number(meeting.durationMinutes || 60),
    transcript: meeting.transcript || "",
    summary: meeting.summary || "",
    key_decisions: splitLines(meeting.keyDecisions),
    talking_points: splitLines(meeting.talkingPoints),
    action_items: normalizeActionItems(meeting.actionItems).map((item) => ({
      task: item.task,
      owner: item.owner,
      due_date: item.dueDate,
      completed: item.completed,
    })),
    follow_up_email_draft: meeting.followUpEmailDraft || "",
    recording_url: meeting.recordingUrl || "",
    ai_processed: Boolean(meeting.aiProcessed),
    prep_material: meeting.prepMaterial || "",
  };
}

function normalizeActionItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    task: String(item.task || "").trim(),
    owner: String(item.owner || "").trim(),
    dueDate: String(item.dueDate || item.due_date || "").trim(),
    completed: Boolean(item.completed),
  })).filter((item) => item.task);
}

function arrayToLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join("\n");
  return String(value || "");
}

function splitLines(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function splitComma(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function mapStatus(value) {
  if (value === "Cancelled") return "Canceled";
  if (value === "Upcoming") return "Proposed";
  return value || "Proposed";
}

function toDatetimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toISOString().slice(0, 16);
}
