import { NextRequest, NextResponse } from "next/server";
import { getSendJobRecipientMessageId, insertEvent } from "@/lib/db";
import { verifyOpenTrackingToken } from "@/lib/open-tracking";

const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64"
);

export const dynamic = "force-dynamic";

function pixelResponse(): NextResponse {
  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function parseRecipientId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export async function GET(req: NextRequest) {
  const recipientId = parseRecipientId(req.nextUrl.searchParams.get("id"));
  const token = (req.nextUrl.searchParams.get("token") ?? "").trim();

  if (!recipientId || !verifyOpenTrackingToken(recipientId, token)) {
    return pixelResponse();
  }

  try {
    const messageId = await getSendJobRecipientMessageId(recipientId);
    if (messageId) {
      const detail = (req.headers.get("user-agent") ?? "").trim().slice(0, 500);
      await insertEvent(messageId, "Open", new Date().toISOString(), detail);
    }
  } catch (error) {
    console.error("Failed to record open tracking event:", error);
  }

  return pixelResponse();
}
