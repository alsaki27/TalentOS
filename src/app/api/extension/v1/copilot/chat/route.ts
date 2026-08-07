// POST /api/extension/v1/copilot/chat
// Scope: extension:queue:read
// Scoped conversational Q&A for the Copilot extension's Chat tab — "why did
// it skip the salary field", "what should I put for X" — grounded in the
// current candidate/job/fill-plan session context the extension sends up.
// Stateless server-side: the extension holds message history client-side
// and resends it each call. Reuses the chat_assistant automation/routing
// (same provider pool as the internal admin chat at /api/chat) rather than
// registering a new automation id — this is the same "conversational
// assistant" job, just scoped by system prompt instead of given DB tools.

import { NextRequest, NextResponse } from "next/server";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.queueRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const body = await req.json();
      const { message, history, sessionContext } = body as {
        message: string;
        history?: ChatMessage[];
        sessionContext?: {
          candidateName?: string;
          jobTitle?: string;
          company?: string;
          domain?: string;
          lastFillPlan?: { selector: string; fieldType: string; value: unknown; confidence: string; reasoning: string }[];
        };
      };

      if (!message || typeof message !== "string") {
        return extensionError("validation_error", "message is required.", 400);
      }

      const systemPrompt = [
        "You are the Copilot extension's in-panel chat assistant. You help an application engineer (AE) understand and adjust what the Application Copilot did on the CURRENT job application form they have open.",
        "You are NOT a general data assistant — you have no database tools and no access to anything outside the session context below. If asked something outside that scope, say so plainly.",
        "Be concise and practical. When asked why a field was filled a certain way (or skipped), explain using the reasoning already given for that field.",
        sessionContext ? `\nSESSION CONTEXT:\n${JSON.stringify(sessionContext, null, 2)}` : "\nSESSION CONTEXT: none provided yet — no form has been analyzed on this page.",
      ].join("\n");

      const messages = [
        ...(Array.isArray(history) ? history : []).map((m) => ({
          role: m.role,
          content: [{ type: "text" as const, text: m.content }],
        })),
        { role: "user" as const, content: [{ type: "text" as const, text: message }] },
      ];

      const { result } = await callWithUsageTracking("chat_assistant", undefined, async (provider) =>
        provider.send({ system: systemPrompt, messages, tools: [] })
      );

      return NextResponse.json({ reply: textOf(result.content) || "(no response)" });
    } catch (err) {
      console.error("[Copilot Chat Error]", err);
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
