// src/app/api/chat/route.ts
// POST -> send a message to the AI assistant. Creates a conversation if none given,
// loads prior text turns for context, runs the tool-calling loop (read-only tools
// in src/lib/ai/tools.ts) until the model gives a final answer or a step cap is hit,
// and persists everything to chat_conversations/chat_messages.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { AiContentBlock, AiMessage, looksDegenerate, textOf, toolUsesOf } from "@/lib/ai/provider";
import { executeTool, TOOLS } from "@/lib/ai/tools";
import { MISSION_CONTEXT } from "@/lib/ai/missionContext";
import {
  listUserConversationIds,
  countUserMessagesToday,
  createConversation,
  getPriorMessages,
  insertUserMessage,
  insertAssistantMessage,
  insertToolMessage,
  touchConversation,
} from "@/server/repositories/chatRepository";

const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_TURNS = 40;
const MAX_USER_MESSAGES_PER_DAY = 200;

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  let providerName: string | undefined;

  const body = await req.json();
  const userMessage = String(body.message ?? "").trim();
  const attachment = body.attachment as
    | { url: string; name: string; type: string; textContent?: string | null }
    | undefined;

  if (!userMessage && !attachment) {
    return NextResponse.json({ error: "message or attachment is required" }, { status: 400 });
  }

  // Cost guardrail: this calls a paid, unsupervised external API. A per-user daily cap
  // bounds worst-case spend from a runaway client/script far more cheaply than discovering
  // the bill later.
  const conversationIds = (await listUserConversationIds(context!.profile.user_id)).map((c) => c.id);

  if (conversationIds.length > 0) {
    const sinceMidnight = new Date();
    sinceMidnight.setHours(0, 0, 0, 0);
    const messagesToday = await countUserMessagesToday(conversationIds, sinceMidnight.toISOString());

    if (messagesToday >= MAX_USER_MESSAGES_PER_DAY) {
      return NextResponse.json(
        { error: `Daily assistant message limit (${MAX_USER_MESSAGES_PER_DAY}) reached. Try again tomorrow.` },
        { status: 429 },
      );
    }
  }

  let conversationId = body.conversation_id as string | undefined;
  const title = userMessage.slice(0, 60) || attachment?.name || "New conversation";

  if (!conversationId) {
    conversationId = await createConversation(context!.profile.user_id, title);
  }

  const priorMessages = await getPriorMessages(conversationId, MAX_HISTORY_TURNS);

  const history: AiMessage[] = (priorMessages ?? []).map((m: any) => {
    let text = m.content as string;
    if (m.attachment_name) {
      text += `\n\n[Attached file: ${m.attachment_name} (${m.attachment_type})]`;
      if (m.attachment_text) text += `\n--- file content ---\n${m.attachment_text}\n--- end file content ---`;
    }
    return { role: m.role as "user" | "assistant", content: [{ type: "text", text }] };
  });

  // The model only ever sees attachments as text: the filename/type always, plus the
  // extracted content for text-based files (set at upload time in /api/chat/attachments).
  // Images/PDFs/docs are stored and shown to the user but not analyzed in this v1.
  let modelText = userMessage;
  if (attachment) {
    modelText += `\n\n[Attached file: ${attachment.name} (${attachment.type})]`;
    if (attachment.textContent) {
      modelText += `\n--- file content ---\n${attachment.textContent}\n--- end file content ---`;
    } else {
      modelText += " (binary file — content not extracted, filename/type only)";
    }
  }

  const messages: AiMessage[] = [...history, { role: "user", content: [{ type: "text", text: modelText }] }];

  await insertUserMessage(
    conversationId,
    userMessage || `Attached: ${attachment?.name}`,
    attachment?.url ?? null,
    attachment?.name ?? null,
    attachment?.type ?? null,
    attachment?.textContent ?? null
  );

  // This prompt is sent to three different model families behind a single
  // AiProvider interface (Anthropic, NVIDIA/Kimi, Gemini via the Vertex proxy),
  // and the same wording has to work for all of them - written more explicitly
  // than pure-Claude prompting would need, since smaller/cheaper models follow
  // looser, more example-driven instructions less reliably than Claude does.
  // The "when NOT to call a tool" section exists because of a real, reproduced
  // failure: before Gemini's tool-calling was wired up correctly, asking "hi" or
  // "are you vertex?" made it emit a literal {"tool_code": "print(talent.
  // list_jobs())"} text block instead of answering - it had absorbed "use tools
  // before answering questions about candidates/jobs/..." as "always look like
  // you're using a tool," with no real mechanism to do so. Real tool-calling is
  // wired up correctly now for all three providers, but a weaker model can still
  // *choose* to call a tool needlessly even with the real mechanism available -
  // fixing the plumbing doesn't fix the judgment call, so the prompt still needs
  // to say this directly rather than assume it's now implied.
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = [
    "You are the internal data assistant for TalentOS, a candidate placement tracker.",
    MISSION_CONTEXT,
    `Today's date is ${today}.`,
    "",
    "When to use a tool: call one of the tools below whenever answering would require real data from this app - candidates, jobs, applications (including priority/review status), companies, analytics, import sources, or the audit log. Never guess, estimate, or fabricate numbers, names, or counts - if a question needs real data and no tool fits, say so plainly instead of making something up.",
    "When NOT to use a tool: greetings, small talk, questions about what you are or what you can do, and general help requests don't need a tool call - just answer directly in plain text. If you're not sure a tool is needed, it probably isn't - answer without one rather than calling something speculatively.",
    "Call the fewest tools that actually answer the question - usually exactly one. Only call more than one if the question genuinely needs data from more than one source (e.g. comparing candidates against jobs).",
    "Tool results are live, authoritative data pulled directly from this app's own database moments ago - not examples, hypotheticals, or data you lack access to. Trust and report them directly; do not hedge by claiming you can't access real-time data after a tool has just given you exactly that.",
    "Be concise. Use plain language, not raw JSON, in your final answer.",
    `The person you're talking to has the role: ${context!.profile.role}.`,
  ].join("\n");

  // On failure, persist a visible error turn instead of leaving the transcript looking
  // like it silently dropped the user's message (which was already saved above).
  async function failWithVisibleError(message: string, status: number) {
    await insertAssistantMessage(conversationId, `(error) ${message}`);
    return NextResponse.json({ conversation_id: conversationId, error: message }, { status });
  }

  const toolsUsed: string[] = [];
  let lastToolCalls: { name: string; result: string }[] = [];
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;
    let aiResponse;
    try {
      const { result, providerName: pn } = await callWithUsageTracking("chat_assistant", { userId: context?.profile.user_id }, async (provider) => {
        return provider.send({ system: systemPrompt, messages, tools: TOOLS });
      });
      aiResponse = result;
      providerName = pn;
    } catch (err: any) {
      return failWithVisibleError(err.message ?? "AI request failed", 502);
    }

    if (aiResponse.stopReason !== "tool_use") {
      let finalText = textOf(aiResponse.content) || "(no response)";
      // Confirmed live with the NVIDIA/Kimi provider: it can degenerate into repeated
      // tokens right after consuming a tool result. Fall back to the raw data rather than
      // show the user garbage — only relevant once at least one tool has actually run.
      if (looksDegenerate(finalText) && lastToolCalls.length > 0) {
        finalText = [
          "I looked up the data but couldn't phrase a clean answer this time. Here's exactly what I found:",
          ...lastToolCalls.map((t) => `\n${t.name}:\n${t.result}`),
        ].join("\n");
      }
      await insertAssistantMessage(conversationId, finalText);
      await touchConversation(conversationId, new Date().toISOString());
      return NextResponse.json({ conversation_id: conversationId, reply: finalText, toolsUsed, provider: providerName ?? "unknown" });
    }

    messages.push({ role: "assistant", content: aiResponse.content });

    const toolResults: AiContentBlock[] = [];
    lastToolCalls = [];
    for (const toolUse of toolUsesOf(aiResponse.content)) {
      toolsUsed.push(toolUse.name);
      const result = await executeTool(toolUse.name, toolUse.input, { role: context!.profile.role });
      lastToolCalls.push({ name: toolUse.name, result });
      await insertToolMessage(conversationId, toolUse.name, JSON.stringify({ input: toolUse.input, result }));
      toolResults.push({ type: "tool_result", toolUseId: toolUse.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return failWithVisibleError("Assistant took too many steps without a final answer.", 500);
}
