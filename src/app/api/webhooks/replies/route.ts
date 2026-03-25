import { NextRequest, NextResponse } from "next/server";
import {
  createContactEvent,
  getSendJobRecipientTracking,
  getSentMessageTracking,
} from "@/lib/db";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";
import { verifyReplyTrackingAddress } from "@/lib/reply-tracking";

interface InboundReplyBody {
  workspaceId?: unknown;
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  inReplyTo?: unknown;
  references?: unknown;
  providerMessageId?: unknown;
  source?: unknown;
  sourceRef?: unknown;
  receivedAt?: unknown;
  idempotencyKey?: unknown;
  replyOutcome?: unknown;
  metadata?: unknown;
}

function normalizeWorkspaceId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeOptionalString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isIsoTimestamp(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    )
  ) {
    return false;
  }

  return !Number.isNaN(Date.parse(value));
}

function extractEmailAddresses(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const emails = new Set<string>();
  const pattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  for (const item of values) {
    if (typeof item !== "string") continue;
    const matches = item.match(pattern) ?? [];
    for (const match of matches) {
      emails.add(match.trim().toLowerCase());
    }
  }

  return Array.from(emails);
}

function normalizeMessageId(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .replace(/^<+/, "")
    .replace(/>+$/, "");
  return text ? text : null;
}

function normalizeMessageIdList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const ids = new Set<string>();

  for (const item of values) {
    if (typeof item !== "string") continue;
    const bracketMatches = Array.from(item.matchAll(/<([^>]+)>/g), (match) =>
      normalizeMessageId(match[1])
    ).filter((entry): entry is string => Boolean(entry));

    if (bracketMatches.length > 0) {
      for (const match of bracketMatches) {
        ids.add(match);
      }
      continue;
    }

    const parts = item
      .split(/[\s,]+/)
      .map((part) => normalizeMessageId(part))
      .filter((entry): entry is string => Boolean(entry));
    for (const part of parts) {
      ids.add(part);
    }
  }

  return Array.from(ids);
}

function buildReplySnippet(text: string | null, subject: string | null): string | null {
  const normalizedText = (text ?? "").trim();
  if (normalizedText) {
    const firstLine = normalizedText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith(">"));
    if (firstLine) {
      return firstLine.slice(0, 500);
    }
  }

  const normalizedSubject = (subject ?? "").trim();
  return normalizedSubject ? normalizedSubject.slice(0, 500) : null;
}

async function resolveMessageIdFromTrackedAddress(
  workspaceId: string,
  addresses: string[]
): Promise<string | null> {
  for (const address of addresses) {
    const parsed = verifyReplyTrackingAddress(address);
    if (!parsed) continue;
    const tracking = await getSendJobRecipientTracking(parsed.recipientId);
    if (!tracking) continue;
    if (tracking.workspaceId !== workspaceId) continue;
    if (tracking.messageId) {
      return tracking.messageId;
    }
  }

  return null;
}

async function resolveMessageIdFromReferences(
  workspaceId: string,
  messageIds: string[]
): Promise<string | null> {
  for (const messageId of messageIds) {
    const tracking = await getSentMessageTracking(workspaceId, messageId);
    if (tracking?.messageId) {
      return tracking.messageId;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    let body: InboundReplyBody;
    try {
      body = (await req.json()) as InboundReplyBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const workspaceId = normalizeWorkspaceId(body.workspaceId);
    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    const auth = await requireWorkspaceAuth(req, workspaceId, "send.write");
    if (auth.authMethod === "api_key" && auth.workspace !== workspaceId) {
      return NextResponse.json(
        { error: "workspaceId does not match API key workspace" },
        { status: 400 }
      );
    }

    const receivedAt = normalizeOptionalString(body.receivedAt);
    if (receivedAt && !isIsoTimestamp(receivedAt)) {
      return NextResponse.json(
        { error: "receivedAt must be a valid ISO timestamp" },
        { status: 400 }
      );
    }

    const toAddresses = extractEmailAddresses(body.to);
    const ccAddresses = extractEmailAddresses(body.cc);
    const fromAddress = extractEmailAddresses(body.from)[0] ?? null;
    const subject = normalizeOptionalString(body.subject);
    const text = normalizeOptionalString(body.text);
    const providerMessageId = normalizeMessageId(body.providerMessageId);
    const sourceRef =
      normalizeOptionalString(body.sourceRef) ?? providerMessageId ?? null;
    const source = normalizeOptionalString(body.source) ?? "inbound_webhook";
    const explicitIdempotencyKey = normalizeOptionalString(body.idempotencyKey);
    const idempotencyKey =
      explicitIdempotencyKey ??
      (sourceRef ? `reply:${source}:${sourceRef}` : null);

    const referenceMessageIds = [
      ...new Set(
        [
          normalizeMessageId(body.inReplyTo),
          ...normalizeMessageIdList(body.references),
        ].filter((entry): entry is string => Boolean(entry))
      ),
    ];

    const resolvedMessageId =
      (await resolveMessageIdFromTrackedAddress(workspaceId, [
        ...toAddresses,
        ...ccAddresses,
      ])) ??
      (await resolveMessageIdFromReferences(workspaceId, referenceMessageIds));

    if (!resolvedMessageId) {
      return NextResponse.json(
        {
          error:
            "Unable to resolve the original outbound message from reply recipients or message headers",
        },
        { status: 404 }
      );
    }

    const metadata = {
      ...normalizeMetadata(body.metadata),
      from: fromAddress,
      to: toAddresses,
      cc: ccAddresses,
      subject,
      inReplyTo: normalizeMessageId(body.inReplyTo),
      references: referenceMessageIds,
      providerMessageId,
    };

    const replyReceived = await createContactEvent({
      workspaceId,
      eventType: "reply_received",
      messageId: resolvedMessageId,
      source,
      sourceRef,
      detail: buildReplySnippet(text, subject),
      metadata,
      occurredAt: receivedAt,
      idempotencyKey,
    });

    const replyOutcomeValue = normalizeOptionalString(body.replyOutcome);
    const replyOutcome = replyOutcomeValue
      ? await createContactEvent({
          workspaceId,
          eventType: "reply_outcome",
          eventValue: replyOutcomeValue,
          messageId: resolvedMessageId,
          source,
          sourceRef,
          metadata,
          occurredAt: receivedAt,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:outcome` : null,
        })
      : null;

    return NextResponse.json({
      resolvedMessageId,
      replyReceived,
      replyOutcome,
    });
  } catch (error) {
    return apiErrorResponse(error, "Failed to ingest inbound reply");
  }
}
