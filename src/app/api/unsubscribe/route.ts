import { NextRequest, NextResponse } from "next/server";
import {
  deleteContact,
  getWorkspaceSettings,
  markContactUnsubscribed,
} from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeWebsiteUrl(value: string | undefined, workspaceId: string): string {
  const raw = (value ?? "").trim() || `https://${workspaceId}`;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return `https://${workspaceId}`;
    }
    return parsed.toString();
  } catch {
    return `https://${workspaceId}`;
  }
}

function buildWorkspaceUnsubscribeUrl(
  value: string | undefined,
  workspaceId: string
): string {
  const websiteUrl = normalizeWebsiteUrl(value, workspaceId);
  try {
    const parsed = new URL(websiteUrl);
    const redirectUrl = new URL("/unsubscribe", parsed.origin);
    return redirectUrl.toString();
  } catch {
    return `https://${workspaceId}/unsubscribe`;
  }
}

function htmlResponse(body: string, status = 200): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function redirectResponse(url: string, status = 302): NextResponse {
  return NextResponse.redirect(url, { status });
}

function renderPage({
  title,
  message,
  ctaUrl,
}: {
  title: string;
  message: string;
  ctaUrl?: string;
}): string {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeCtaUrl = ctaUrl ? escapeHtml(ctaUrl) : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeTitle}</title>
  </head>
  <body style="font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #f9fafb; color: #111827;">
    <main style="max-width: 540px; margin: 12vh auto 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px;">
      <h1 style="margin: 0 0 12px 0; font-size: 22px; line-height: 1.2;">${safeTitle}</h1>
      <p style="margin: 0; color: #4b5563; line-height: 1.55;">${safeMessage}</p>
      ${
        safeCtaUrl
          ? `<p style="margin: 18px 0 0 0;"><a href="${safeCtaUrl}" style="color: #2563eb;">Visit website</a></p>`
          : ""
      }
    </main>
  </body>
</html>`;
}

export async function POST(req: NextRequest) {
  const workspace = (req.nextUrl.searchParams.get("workspace") ?? "")
    .trim()
    .toLowerCase();
  const email = (req.nextUrl.searchParams.get("email") ?? "").trim();
  const token = (req.nextUrl.searchParams.get("token") ?? "").trim();

  if (!workspace || !email || !token) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  if (!verifyUnsubscribeToken(workspace, email, token)) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  try {
    await markContactUnsubscribed(workspace, email);
    await deleteContact(workspace, email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unsubscribe POST failed:", error);
    return NextResponse.json(
      { error: "Unsubscribe failed" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const workspace = (req.nextUrl.searchParams.get("workspace") ?? "")
    .trim()
    .toLowerCase();
  const email = (req.nextUrl.searchParams.get("email") ?? "").trim();
  const token = (req.nextUrl.searchParams.get("token") ?? "").trim();

  if (!workspace || !email || !token) {
    return htmlResponse(
      renderPage({
        title: "Invalid unsubscribe link",
        message: "This link is missing required information.",
      }),
      400
    );
  }

  if (!verifyUnsubscribeToken(workspace, email, token)) {
    return htmlResponse(
      renderPage({
        title: "Invalid unsubscribe link",
        message: "This unsubscribe link is not valid.",
      }),
      400
    );
  }

  try {
    await markContactUnsubscribed(workspace, email);
    await deleteContact(workspace, email);
    const settings = await getWorkspaceSettings(workspace);
    const redirectUrl = buildWorkspaceUnsubscribeUrl(
      settings?.website_url,
      workspace
    );
    return redirectResponse(redirectUrl);
  } catch (error) {
    console.error("Unsubscribe failed:", error);
    return htmlResponse(
      renderPage({
        title: "Unable to unsubscribe",
        message: "Please try again later.",
      }),
      500
    );
  }
}
