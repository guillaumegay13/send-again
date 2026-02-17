import { NextRequest, NextResponse } from "next/server";
import { upsertWorkspaceSettings, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

function normalizeWebsiteUrl(value: unknown): string | null {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = await req.json();
    const { id, from, configSet, rateLimit, footerHtml, websiteUrl } = body;
    if (!id || !from) {
      return NextResponse.json(
        { error: "id and from required" },
        { status: 400 }
      );
    }
    const normalizedWebsiteUrl = normalizeWebsiteUrl(websiteUrl);
    if (normalizedWebsiteUrl === null) {
      return NextResponse.json(
        { error: "websiteUrl must be a valid http(s) URL" },
        { status: 400 }
      );
    }

    const hasAccess = await userCanAccessWorkspace(user.id, id);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    await upsertWorkspaceSettings({
      id,
      from,
      configSet: configSet ?? "email-tracking-config-set",
      rateLimit: rateLimit ?? 300,
      footerHtml: typeof footerHtml === "string" ? footerHtml : "",
      websiteUrl: normalizedWebsiteUrl,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
