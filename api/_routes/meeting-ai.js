import { json, readBody, requireAdmin } from "../_admin-auth.js";
import { base44Client } from "../_base44.js";

export default async function handler(req, res) {
  const session = requireAdmin(req, res);
  if (!session) return;
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  try {
    const body = await readBody(req);
    const meeting = body.meeting || {};
    if (!meeting.transcript) return json(res, 400, { error: "Meeting transcript is required" });
    const result = await invokeMeetingLLM(meeting);
    return json(res, 200, { result });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Meeting AI failed" });
  }
}

async function invokeMeetingLLM(meeting) {
  const base44 = base44Client();
  const result = await base44.integrations.Core.InvokeLLM({
    prompt: `You are an expert meeting analyst. Analyze the following meeting transcript and extract structured information.

Meeting: "${meeting.title || meeting.type || "Meeting"}"
Platform: ${meeting.platform || "Unknown"}
Attendees: ${meeting.attendees || "Unknown"}
Date: ${meeting.datetime || ""}

TRANSCRIPT:
${meeting.transcript}

Generate comprehensive meeting insights.`,
    response_json_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "A concise 2-4 sentence TL;DR summary of the meeting" },
        key_decisions: {
          type: "array",
          items: { type: "string" },
          description: "List of key decisions made during the meeting",
        },
        talking_points: {
          type: "array",
          items: { type: "string" },
          description: "Main discussion highlights and talking points",
        },
        action_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              task: { type: "string" },
              owner: { type: "string" },
              due_date: { type: "string" },
              completed: { type: "boolean" },
            },
          },
          description: "Action items with owner names and suggested due dates",
        },
        follow_up_email_draft: {
          type: "string",
          description: "A professional follow-up email draft summarizing the meeting",
        },
      },
    },
  });
  return normalizeAnalysis(result);
}

function normalizeAnalysis(value = {}) {
  return {
    summary: String(value.summary || "").trim(),
    keyDecisions: toLines(value.keyDecisions || value.key_decisions),
    talkingPoints: toLines(value.talkingPoints || value.talking_points),
    actionItems: Array.isArray(value.actionItems || value.action_items)
      ? (value.actionItems || value.action_items).map((item) => ({
        task: String(item.task || "").trim(),
        owner: String(item.owner || "").trim(),
        dueDate: String(item.dueDate || item.due_date || "").trim(),
        completed: Boolean(item.completed),
      })).filter((item) => item.task)
      : [],
    followUpEmailDraft: String(value.followUpEmailDraft || value.follow_up_email_draft || "").trim(),
  };
}

function toLines(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).join("\n");
  return String(value || "").trim();
}
