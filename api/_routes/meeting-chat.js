import { json, readBody, requireAdmin } from "../_admin-auth.js";
import { readCrmData, writeCrmData } from "../_db.js";
import { randomUUID } from "node:crypto";
import { base44Client } from "../_base44.js";

export default async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  try {
    if (req.method === "GET") {
      const meetingId = String(req.query?.meetingId || "");
      const data = await readCrmData();
      const messages = (data.meetingChats || []).filter((message) => message.meetingId === meetingId).slice(-50);
      return json(res, 200, { messages });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const meetingId = String(body.meetingId || "");
      const question = String(body.question || "").trim();
      if (!meetingId || !question) return json(res, 400, { error: "meetingId and question are required" });

      const data = await readCrmData();
      data.meetingChats ||= [];
      const meeting = (data.meetings || []).find((item) => item.id === meetingId) || body.meeting;
      if (!meeting) return json(res, 404, { error: "Meeting not found" });

      const userMessage = chatMessage(meetingId, "user", question);
      const answer = await answerMeetingQuestion(meeting, question);
      const assistantMessage = chatMessage(meetingId, "assistant", answer);
      data.meetingChats.push(userMessage, assistantMessage);
      data.meetingChats = data.meetingChats.slice(-500);
      await writeCrmData(data, session.email, "Updated meeting chat");
      return json(res, 200, { messages: [userMessage, assistantMessage] });
    }
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Meeting chat failed" });
  }
}

async function answerMeetingQuestion(meeting, question) {
  const prompt = `You are a helpful meeting assistant. Answer questions about the following meeting based on its transcript and notes.

MEETING: ${meeting.title || meeting.type || "Meeting"}
DATE: ${meeting.datetime || ""}
ATTENDEES: ${meeting.attendees || ""}

TRANSCRIPT:
${meeting.transcript || "(No transcript available)"}

SUMMARY:
${meeting.summary || "(Not yet generated)"}

ACTION ITEMS:
${(meeting.actionItems || []).map((item) => `- ${item.task} (Owner: ${item.owner || "TBD"})`).join("\n") || "(None)"}

USER QUESTION: ${question}

Provide a concise, accurate answer based solely on the meeting content above.`;
  try {
    const base44 = base44Client();
    const response = await base44.integrations.Core.InvokeLLM({ prompt });
    return typeof response === "string" ? response : JSON.stringify(response);
  } catch (error) {
    if ((error.status || error.statusCode) === 404) {
      return [
        "Base44 returned 404 for InvokeLLM, so I could not reach the configured Base44 integration endpoint.",
        "",
        "Check BASE44_APP_ID, BASE44_SERVER_URL, BASE44_ACCESS_TOKEN or BASE44_SERVICE_TOKEN, and that Core InvokeLLM is enabled for that Base44 app.",
        "",
        fallbackAnswer(meeting, question),
      ].join("\n");
    }
    throw error;
  }
}

function fallbackAnswer(meeting, question) {
  const haystack = [
    meeting.summary || "",
    meeting.keyDecisions || "",
    meeting.talkingPoints || "",
    JSON.stringify(meeting.actionItems || []),
    meeting.transcript || "",
  ].join("\n");
  const words = String(question || "").toLowerCase().split(/\W+/).filter((word) => word.length > 3);
  const matches = haystack
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => words.some((word) => line.toLowerCase().includes(word)))
    .slice(0, 4);
  if (matches.length) return `Local fallback from meeting content:\n${matches.map((line) => `- ${line}`).join("\n")}`;
  return "Local fallback could not find a confident answer in the meeting transcript or notes.";
}

function chatMessage(meetingId, role, content) {
  return {
    id: randomUUID(),
    meetingId,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}
