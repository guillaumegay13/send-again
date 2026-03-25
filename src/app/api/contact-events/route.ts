import { NextRequest, NextResponse } from "next/server";
import { createContactEvent, listContactEvents } from "@/lib/db";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function normalizeWorkspaceId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeOptionalString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  try {
    const workspaceId = normalizeWorkspaceId(
      req.nextUrl.searchParams.get("workspace")
    );
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing workspace parameter" },
        { status: 400 }
      );
    }

    const auth = await requireWorkspaceAuth(req, workspaceId, "send.read");
    if (auth.authMethod === "api_key" && auth.workspace !== workspaceId) {
      return NextResponse.json(
        { error: "workspace does not match API key workspace" },
        { status: 400 }
      );
    }

    const items = await listContactEvents({
      workspaceId,
      contactEmail: req.nextUrl.searchParams.get("contact"),
      messageId: req.nextUrl.searchParams.get("messageId"),
      eventType: req.nextUrl.searchParams.get("eventType"),
      limit: parseLimit(req.nextUrl.searchParams.get("limit")),
    });

    return NextResponse.json({ items });
  } catch (error) {
    return apiErrorResponse(error, "Failed to read contact events");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      workspaceId?: unknown;
      contactEmail?: unknown;
      eventType?: unknown;
      eventValue?: unknown;
      messageId?: unknown;
      source?: unknown;
      sourceRef?: unknown;
      detail?: unknown;
      metadata?: unknown;
      occurredAt?: unknown;
      idempotencyKey?: unknown;
    };

    const workspaceId = normalizeWorkspaceId(body.workspaceId);
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing workspaceId" },
        { status: 400 }
      );
    }

    const auth = await requireWorkspaceAuth(req, workspaceId, "send.write");
    if (auth.authMethod === "api_key" && auth.workspace !== workspaceId) {
      return NextResponse.json(
        { error: "workspaceId does not match API key workspace" },
        { status: 400 }
      );
    }

    const eventType = normalizeOptionalString(body.eventType);
    if (!eventType) {
      return NextResponse.json(
        { error: "Missing eventType" },
        { status: 400 }
      );
    }

    const messageId = normalizeOptionalString(body.messageId);
    const contactEmail = normalizeOptionalString(body.contactEmail);
    if (!messageId && !contactEmail) {
      return NextResponse.json(
        { error: "Provide messageId or contactEmail" },
        { status: 400 }
      );
    }

    const occurredAt = normalizeOptionalString(body.occurredAt);
    if (occurredAt && Number.isNaN(Date.parse(occurredAt))) {
      return NextResponse.json(
        { error: "occurredAt must be a valid ISO timestamp" },
        { status: 400 }
      );
    }

    const item = await createContactEvent({
      workspaceId,
      contactEmail,
      eventType,
      eventValue: normalizeOptionalString(body.eventValue),
      messageId,
      source: normalizeOptionalString(body.source),
      sourceRef: normalizeOptionalString(body.sourceRef),
      detail: normalizeOptionalString(body.detail),
      metadata: normalizeMetadata(body.metadata),
      occurredAt,
      idempotencyKey: normalizeOptionalString(body.idempotencyKey),
    });

    return NextResponse.json(item);
  } catch (error) {
    return apiErrorResponse(error, "Failed to create contact event");
  }
}
