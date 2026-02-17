import { NextRequest, NextResponse } from "next/server";
import { insertEvent } from "@/lib/db";

function normalizeEventType(eventType: string): string {
  switch (eventType.trim().toLowerCase()) {
    case "send":
      return "Send";
    case "delivery":
      return "Delivery";
    case "open":
      return "Open";
    case "click":
      return "Click";
    case "bounce":
      return "Bounce";
    case "complaint":
      return "Complaint";
    default:
      return eventType;
  }
}

function getEventTimestamp(
  message: Record<string, unknown>,
  eventType: string,
  fallbackTimestamp: string | undefined
): string {
  const eventPayload = message[eventType.toLowerCase()] as
    | Record<string, unknown>
    | undefined;
  const eventTimestamp = eventPayload?.timestamp as string | undefined;
  const mail = message.mail as Record<string, unknown> | undefined;
  const mailTimestamp = mail?.timestamp as string | undefined;
  return eventTimestamp || mailTimestamp || fallbackTimestamp || new Date().toISOString();
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messageType = req.headers.get("x-amz-sns-message-type");

  // --- Subscription confirmation ---
  if (messageType === "SubscriptionConfirmation") {
    const subscribeUrl = payload.SubscribeURL as string | undefined;
    if (subscribeUrl) {
      try {
        await fetch(subscribeUrl);
        console.log("SNS subscription confirmed");
      } catch (err) {
        console.error("Failed to confirm SNS subscription:", err);
      }
    }
    return NextResponse.json({ status: "subscribed" });
  }

  // --- Notification ---
  if (messageType === "Notification") {
    try {
      const message = JSON.parse(payload.Message as string) as Record<string, unknown>;
      const rawEventType = message.eventType as string | undefined;
      const eventType = rawEventType ? normalizeEventType(rawEventType) : undefined;
      const mail = message.mail as Record<string, unknown> | undefined;
      const messageId = mail?.messageId as string | undefined;
      const timestamp = getEventTimestamp(
        message,
        eventType ?? "",
        payload.Timestamp as string | undefined
      );

      if (!eventType || !messageId) {
        return NextResponse.json({ status: "ignored" });
      }

      // Extract event-specific detail
      let detail = "";
      switch (eventType) {
        case "Bounce": {
          const bounce = message.bounce;
          detail = bounce?.bounceType
            ? `${bounce.bounceType}/${bounce.bounceSubType ?? ""}`
            : "";
          break;
        }
        case "Complaint": {
          const complaint = message.complaint;
          detail = complaint?.complaintFeedbackType ?? "";
          break;
        }
        case "Click": {
          const click = message.click;
          detail = click?.link ?? "";
          break;
        }
        case "Open": {
          const open = message.open;
          detail = open?.userAgent ?? "";
          break;
        }
      }

      await insertEvent(messageId, eventType, timestamp, detail);
    } catch (err) {
      console.error("Failed to process SNS notification:", err);
    }
    return NextResponse.json({ status: "ok" });
  }

  return NextResponse.json({ status: "ignored" });
}
