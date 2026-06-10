import { json, requireAdmin } from "../_admin-auth.js";
import { readCrmData, writeCrmData } from "../_db.js";
import { meetingExists, normalizeFathomMeeting } from "../_meeting-integrations.js";
import { base44Client, base44MeetingToCrm } from "../_base44.js";

export default async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    if (process.env.BASE44_APP_ID && String(process.env.BASE44_FATHOM_MODE || "").toLowerCase() === "remote") {
      return await importViaBase44(req, res, session);
    }
    if (!process.env.FATHOM_API_KEY) return json(res, 400, { error: "FATHOM_API_KEY is not configured" });
    const response = await fetch("https://api.fathom.ai/external/v1/meetings?include_transcript=true&include_summary=true&include_action_items=true", {
      headers: { "X-Api-Key": process.env.FATHOM_API_KEY },
    });
    if (!response.ok) {
      const detail = await response.text();
      return json(res, 502, { error: `Fathom API error: ${response.status} ${detail}` });
    }

    const payload = await response.json();
    const fathomMeetings = payload.items || [];
    const data = await readCrmData();
    data.meetings ||= [];

    let imported = 0;
    fathomMeetings.forEach((item) => {
      const meeting = normalizeFathomMeeting(item);
      if (meetingExists(data.meetings, meeting)) return;
      data.meetings.push(meeting);
      imported += 1;
    });

    if (imported) await writeCrmData(data, session.email, `Imported ${imported} Fathom meeting${imported === 1 ? "" : "s"}`);
    return json(res, 200, { imported, totalInFathom: fathomMeetings.length });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Fathom import failed" });
  }
}

async function importViaBase44(req, res, session) {
  const base44 = base44Client();
  const invokeResult = await base44.functions.invoke("importFathomMeetings", {});
  const base44Meetings = await base44.entities.Meeting.list("-created_date", 100);
  const data = await readCrmData();
  data.meetings ||= [];

  let synced = 0;
  base44Meetings.forEach((record) => {
    const meeting = base44MeetingToCrm(record);
    if (meetingExists(data.meetings, meeting)) return;
    data.meetings.push(meeting);
    synced += 1;
  });

  if (synced) await writeCrmData(data, session.email, `Synced ${synced} Base44 meeting${synced === 1 ? "" : "s"}`);
  return json(res, 200, {
    mode: "base44",
    base44: invokeResult?.data || invokeResult,
    synced,
    imported: synced,
  });
}
