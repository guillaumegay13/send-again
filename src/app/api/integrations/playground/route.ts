import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getWorkspaceSettings, userCanAccessWorkspace } from "@/lib/db";

interface PlaygroundBody {
  workspace: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  includeIntegrationAuth?: boolean;
}

interface PlaygroundResponse {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: unknown;
}

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function normalizeMethod(value: unknown): string {
  const method = String(value ?? "GET").trim().toUpperCase();
  return ALLOWED_METHODS.has(method) ? method : "GET";
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const headers: Record<string, string> = {};
  for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (!key) continue;
    headers[key] = rawVal == null ? "" : String(rawVal);
  }
  return headers;
}

function hasHeader(headers: Record<string, string>, key: string): boolean {
  const target = key.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === target);
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = (await req.json()) as PlaygroundBody;

    const workspace = String(body.workspace ?? "").trim().toLowerCase();
    if (!workspace) {
      return NextResponse.json({ error: "workspace required" }, { status: 400 });
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const url = normalizeUrl(body.url);
    if (!url) {
      return NextResponse.json(
        { error: "url must be a valid http(s) URL" },
        { status: 400 }
      );
    }

    const method = normalizeMethod(body.method);
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      ...normalizeHeaders(body.headers),
    };

    if (body.includeIntegrationAuth !== false) {
      const config = (await getWorkspaceSettings(workspace))?.contact_source_config ?? {};
      const token = config.token?.trim() ?? "";
      const tokenHeader = config.tokenHeader?.trim() ?? "";
      const tokenPrefix = config.tokenPrefix?.trim() ?? "";
      if (token && tokenHeader && !hasHeader(headers, tokenHeader)) {
        headers[tokenHeader] = tokenPrefix ? `${tokenPrefix} ${token}`.trim() : token;
      }
    }

    const timeoutMsRaw = Number(body.timeoutMs ?? 15000);
    const timeoutMs = Number.isFinite(timeoutMsRaw)
      ? Math.min(Math.max(timeoutMsRaw, 1000), 120000)
      : 15000;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        cache: "no-store",
        body: method === "GET" || method === "DELETE" ? undefined : body.body ?? "",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    const bodyText = text.length > 100_000 ? `${text.slice(0, 100_000)}\n\n...[truncated]` : text;

    let bodyJson: unknown;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("json") && bodyText.trim()) {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }
    }

    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of response.headers.entries()) {
      responseHeaders[key] = value;
    }

    const payload: PlaygroundResponse = {
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - startedAt,
      headers: responseHeaders,
      bodyText,
      ...(bodyJson !== undefined ? { bodyJson } : {}),
    };

    return NextResponse.json(payload);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
