import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export function normalizeFathomMeeting(payload = {}) {
  const title = payload.meeting_title || payload.title || "Fathom Meeting";
  const datetime = payload.recording_start_time || payload.scheduled_start_time || payload.created_at || new Date().toISOString();
  const fathomUrl = payload.url || payload.share_url || "";
  const transcript = formatTranscriptArray(payload.transcript);
  const summary = payload.default_summary?.markdown_formatted || payload.summary || "";
  const attendees = (payload.calendar_invitees || [])
    .map((invitee) => invitee.name || invitee.email)
    .filter(Boolean);
  const actionItems = (payload.action_items || []).map((item) => ({
    task: item.description || item.task || "",
    owner: item.assignee?.name || item.owner || "",
    dueDate: item.due_date || item.dueDate || "",
    completed: Boolean(item.completed),
  })).filter((item) => item.task);
  return {
    id: randomUUID(),
    clientId: "",
    type: "Review",
    title,
    datetime: toDatetimeLocal(datetime),
    platform: "Other",
    attendees: attendees.join(", "),
    status: "Completed",
    proposedBy: "Agency",
    durationMinutes: durationMinutes(payload),
    transcript,
    summary,
    actionItems,
    followUpEmailDraft: "",
    recordingUrl: fathomUrl,
    fathomRecordingId: payload.recording_id || payload.id || "",
    aiProcessed: Boolean(summary || transcript || actionItems.length),
    notes: fathomUrl ? `Imported from Fathom: ${fathomUrl}` : "Imported from Fathom",
  };
}

export function formatTranscriptArray(transcriptArr) {
  if (!Array.isArray(transcriptArr) || !transcriptArr.length) return "";
  return transcriptArr
    .map((entry) => {
      const speaker = entry.speaker?.display_name || entry.speaker?.name || entry.speaker || "Unknown";
      const time = entry.timestamp ? `[${entry.timestamp}] ` : "";
      return `${time}${speaker}: ${entry.text || ""}`.trim();
    })
    .filter(Boolean)
    .join("\n");
}

export function verifyFathomSignature({ headers, rawBody, secret }) {
  if (!secret) return { ok: false, error: "FATHOM_WEBHOOK_SECRET is not configured" };
  const webhookId = header(headers, "webhook-id");
  const webhookTimestamp = header(headers, "webhook-timestamp");
  const webhookSignature = header(headers, "webhook-signature");
  const timestamp = Number.parseInt(webhookTimestamp, 10);
  if (!webhookId || !webhookTimestamp || !webhookSignature || !Number.isFinite(timestamp)) {
    return { ok: false, error: "Missing Fathom webhook signature headers" };
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    return { ok: false, error: "Webhook timestamp too old" };
  }
  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const secretPart = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(secretPart, "base64");
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");
  const signatures = webhookSignature.split(" ").map((signature) => {
    const parts = signature.split(",");
    return parts.length > 1 ? parts[1] : parts[0];
  });
  const ok = signatures.some((signature) => safeEqual(signature, expected));
  return ok ? { ok: true } : { ok: false, error: "Invalid webhook signature" };
}

export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export function splitLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "").split(/\r?\n/).map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

export function meetingExists(meetings, meeting) {
  return meetings.some((item) => {
    if (meeting.base44Id && item.base44Id === meeting.base44Id) return true;
    if (meeting.recordingUrl && item.recordingUrl === meeting.recordingUrl) return true;
    if (meeting.fathomRecordingId && item.fathomRecordingId === meeting.fathomRecordingId) return true;
    return item.title === meeting.title && item.datetime === meeting.datetime && item.transcript === meeting.transcript;
  });
}

function durationMinutes(payload) {
  if (payload.duration_minutes || payload.durationMinutes) return Number(payload.duration_minutes || payload.durationMinutes);
  if (!payload.recording_start_time || !payload.recording_end_time) return 60;
  const start = new Date(payload.recording_start_time);
  const end = new Date(payload.recording_end_time);
  const diff = Math.round((end - start) / 60000);
  return Number.isFinite(diff) && diff > 0 ? diff : 60;
}

function toDatetimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toISOString().slice(0, 16);
}

function header(headers, name) {
  return headers[name] || headers[name.toLowerCase()] || "";
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}
