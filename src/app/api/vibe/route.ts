import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { userCanAccessWorkspace } from "@/lib/db";

type VibeTarget = "email" | "footer";

interface VibeRequestBody {
  workspaceId: string;
  target: VibeTarget;
  instruction: string;
  currentHtml?: string;
  from?: string;
  websiteUrl?: string;
}

function normalizeTarget(value: unknown): VibeTarget | null {
  if (value === "email" || value === "footer") return value;
  return null;
}

function extractGeneratedText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";

  const firstChoice = choices[0] as {
    message?: { content?: unknown };
  };
  const content = firstChoice.message?.content;
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .join("");
  }

  return "";
}

function stripCodeFences(value: string): string {
  let result = value.trim();
  if (result.startsWith("```")) {
    result = result.replace(/^```[a-zA-Z]*\s*/, "");
    result = result.replace(/\s*```$/, "");
  }
  return result.trim();
}

function buildSystemPrompt(target: VibeTarget): string {
  if (target === "footer") {
    return [
      "You generate HTML email footer fragments.",
      "Return raw HTML only, with inline styles. Do not return markdown or code fences.",
      "Keep output concise and production-ready for email clients.",
      "Always include a clickable unsubscribe link using {{unsubscribe_url}}.",
      "You may include a website link with {{workspace_url}}.",
      "Do not include <html> or <body> tags.",
    ].join(" ");
  }

  return [
    "You generate HTML email body fragments.",
    "Return raw HTML only, with inline styles. Do not return markdown or code fences.",
    "Keep output concise and readable in email clients.",
    "Do not include <html> or <body> tags.",
    "Do not include a footer or unsubscribe section, that is appended separately.",
  ].join(" ");
}

function buildUserPrompt({
  workspaceId,
  instruction,
  currentHtml,
  from,
  websiteUrl,
  target,
}: {
  workspaceId: string;
  instruction: string;
  currentHtml: string;
  from: string;
  websiteUrl: string;
  target: VibeTarget;
}): string {
  return [
    `Workspace: ${workspaceId}`,
    `From: ${from || `noreply@${workspaceId}`}`,
    `Website: ${websiteUrl || `https://${workspaceId}`}`,
    `Target: ${target}`,
    "",
    "Instruction:",
    instruction,
    "",
    currentHtml
      ? `Current HTML draft to revise:\n${currentHtml}`
      : "No current draft exists. Create from scratch.",
    "",
    "Return only HTML.",
  ].join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = (await req.json()) as VibeRequestBody;
    const workspaceId = (body.workspaceId ?? "").trim().toLowerCase();
    const target = normalizeTarget(body.target);
    const instruction = (body.instruction ?? "").trim();
    const currentHtml = (body.currentHtml ?? "").trim();
    const from = (body.from ?? "").trim();
    const websiteUrl = (body.websiteUrl ?? "").trim();

    if (!workspaceId || !target || !instruction) {
      return NextResponse.json(
        { error: "workspaceId, target, and instruction are required" },
        { status: 400 }
      );
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspaceId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "Set OPENAI_API_KEY to enable vibe generation" },
        { status: 500 }
      );
    }
    const model = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(target),
          },
          {
            role: "user",
            content: buildUserPrompt({
              workspaceId,
              instruction,
              currentHtml,
              from,
              websiteUrl,
              target,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        { error: `Generation failed: ${detail.slice(0, 500)}` },
        { status: 502 }
      );
    }

    const payload = (await response.json()) as unknown;
    const generated = stripCodeFences(extractGeneratedText(payload));
    if (!generated) {
      return NextResponse.json(
        { error: "No HTML was generated. Try a clearer prompt." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      html: generated,
      model,
    });
  } catch (error) {
    return apiErrorResponse(error, "Failed to generate vibe draft");
  }
}
