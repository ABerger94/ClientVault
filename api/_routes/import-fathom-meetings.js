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
      try {
        return await importViaBase44(req, res, session);
      } catch (error) {
        if (!process.env.FATHOM_API_KEY) {
          return json(res, error.status || error.statusCode || 500, {
            error: base44ImportErrorMessage(error),
            base44Status: error.status || error.statusCode || null,
          });
        }
        const fallback = await importViaFathomApi(session);
        return json(res, 200, {
          ...fallback,
          mode: "fathom-api-fallback",
          base44Error: base44ImportErrorMessage(error),
          base44Status: error.status || error.statusCode || null,
        });
      }
    }
    return json(res, 200, await importViaFathomApi(session));
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Fathom import failed" });
  }
}

async function importViaFathomApi(session) {
  if (!process.env.FATHOM_API_KEY) {
    const error = new Error("FATHOM_API_KEY is not configured");
    error.statusCode = 400;
    throw error;
  }
  const response = await fetch("https://api.fathom.ai/external/v1/meetings?include_transcript=true&include_summary=true&include_action_items=true", {
    headers: { "X-Api-Key": process.env.FATHOM_API_KEY },
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`Fathom API error: ${response.status} ${detail}`);
    error.statusCode = 502;
    throw error;
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
  return { mode: "fathom-api", imported, totalInFathom: fathomMeetings.length };
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

function base44ImportErrorMessage(error) {
  if ((error.status || error.statusCode) === 404) {
    return "Base44 function importFathomMeetings returned 404. Check BASE44_APP_ID, BASE44_SERVER_URL, BASE44_FUNCTIONS_VERSION, and that the Base44 app has deployed a function named importFathomMeetings.";
  }
  return error.message || "Base44 Fathom import failed";
}
