import { json } from "../_admin-auth.js";
import { readCrmData, writeCrmData } from "../_db.js";
import { meetingExists, normalizeFathomMeeting, readRawBody, verifyFathomSignature } from "../_meeting-integrations.js";
import { base44ApiClient, base44Client, base44MeetingToCrm, fetchBase44Function } from "../_base44.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const rawBody = await readRawBody(req);
    if (process.env.BASE44_APP_ID && String(process.env.BASE44_FATHOM_MODE || "").toLowerCase() === "remote") {
      return await forwardToBase44Webhook(req, res, rawBody);
    }
    const verification = verifyFathomSignature({
      headers: req.headers,
      rawBody,
      secret: process.env.FATHOM_WEBHOOK_SECRET || "",
    });
    if (!verification.ok) return json(res, 401, { error: verification.error });

    const payload = JSON.parse(rawBody || "{}");
    let meeting = normalizeFathomMeeting(payload);

    if (!meeting.transcript && meeting.fathomRecordingId && process.env.FATHOM_API_KEY) {
      const enriched = await fetchFathomMeeting(meeting.fathomRecordingId);
      if (enriched) meeting = { ...meeting, ...normalizeFathomMeeting(enriched), id: meeting.id };
    }

    const data = await readCrmData();
    data.meetings ||= [];
    if (!meetingExists(data.meetings, meeting)) {
      data.meetings.push(meeting);
      await writeCrmData(data, "fathom", "Imported Fathom meeting");
    }

    return json(res, 200, { success: true, meetingId: meeting.id });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Fathom webhook failed" });
  }
}

async function forwardToBase44Webhook(req, res, rawBody) {
  const base44 = base44Client();
  const response = await fetchBase44Function("fathomWebhook", {
    method: "POST",
    headers: {
      "content-type": req.headers["content-type"] || "application/json",
      "webhook-id": req.headers["webhook-id"] || "",
      "webhook-timestamp": req.headers["webhook-timestamp"] || "",
      "webhook-signature": req.headers["webhook-signature"] || "",
    },
    body: rawBody,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return json(res, response.status, payload);

  const base44Meetings = await base44ApiClient(base44).entities.Meeting.list("-created_date", 25);
  const data = await readCrmData();
  data.meetings ||= [];
  let synced = 0;
  base44Meetings.forEach((record) => {
    const meeting = base44MeetingToCrm(record);
    if (meetingExists(data.meetings, meeting)) return;
    data.meetings.push(meeting);
    synced += 1;
  });
  if (synced) await writeCrmData(data, "base44", `Synced ${synced} Base44 meeting${synced === 1 ? "" : "s"}`);
  return json(res, 200, { ...payload, synced });
}

async function fetchFathomMeeting(recordingId) {
  const response = await fetch("https://api.fathom.ai/external/v1/meetings?include_transcript=true&include_summary=true&include_action_items=true", {
    headers: { "X-Api-Key": process.env.FATHOM_API_KEY },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return (data.items || []).find((meeting) => meeting.recording_id === recordingId) || null;
}
