import { NextRequest, NextResponse } from "next/server";
import {
  type ContactSourceProvider,
  upsertWorkspaceSettings,
  userCanAccessWorkspace,
} from "@/lib/db";
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

function normalizeContactSourceProvider(value: unknown): ContactSourceProvider {
  if (value === "http_json") return "http_json";
  if (value === "airconcierge") return "http_json";
  return "manual";
}

function normalizeContactSourceConfig(
  value: unknown
): Record<string, string> | null {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;

  const normalized: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    normalized[key] = raw == null ? "" : String(raw);
  }
  return normalized;
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = await req.json();
    const {
      id,
      from,
      configSet,
      rateLimit,
      footerHtml,
      websiteUrl,
      contactSourceProvider,
      contactSourceConfig,
    } = body;
    if (!id || !from) {
      return NextResponse.json(
        { error: "id and from required" },
        { status: 400 }
      );
    }

    const normalizedContactSourceConfig =
      normalizeContactSourceConfig(contactSourceConfig);
    if (normalizedContactSourceConfig === null) {
      return NextResponse.json(
        { error: "contactSourceConfig must be an object" },
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
      contactSourceProvider: normalizeContactSourceProvider(
        contactSourceProvider
      ),
      contactSourceConfig: normalizedContactSourceConfig,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
