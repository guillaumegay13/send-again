import { NextRequest, NextResponse } from "next/server";
import { insertEvent } from "@/lib/db";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

const EVENT_PAYLOAD_KEY: Record<string, string> = {
  Send: "send",
  Delivery: "delivery",
  Open: "open",
  Click: "click",
  Bounce: "bounce",
  Complaint: "complaint",
  Reject: "reject",
  DeliveryDelay: "deliveryDelay",
  RenderingFailure: "failure",
  Subscription: "subscription",
};

function normalizeEventTypeKey(eventType: string): string {
  return eventType.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeEventType(eventType: string): string {
  switch (normalizeEventTypeKey(eventType)) {
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
    case "reject":
      return "Reject";
    case "deliverydelay":
      return "DeliveryDelay";
    case "renderingfailure":
      return "RenderingFailure";
    case "subscription":
      return "Subscription";
    default:
      return eventType.trim();
  }
}

function getEventPayload(
  message: Record<string, unknown>,
  eventType: string
): Record<string, unknown> | undefined {
  const payloadKey = EVENT_PAYLOAD_KEY[eventType] ?? eventType;
  return asRecord(message[payloadKey]) ?? asRecord(message[payloadKey.toLowerCase()]);
}

function getEventTimestamp(
  message: Record<string, unknown>,
  eventType: string,
  fallbackTimestamp: string | undefined
): string {
  const eventPayload = getEventPayload(message, eventType);
  const eventTimestamp = asString(eventPayload?.timestamp);
  const mail = asRecord(message.mail);
  const mailTimestamp = asString(mail?.timestamp);
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
      const rawEventType = asString(message.eventType);
      const eventType = rawEventType ? normalizeEventType(rawEventType) : undefined;
      const mail = asRecord(message.mail);
      const messageId = asString(mail?.messageId);
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
          const bounce = getEventPayload(message, eventType);
          const bounceType = asString(bounce?.bounceType);
          const bounceSubType = asString(bounce?.bounceSubType);
          detail = [bounceType, bounceSubType].filter(Boolean).join("/");
          break;
        }
        case "Complaint": {
          const complaint = getEventPayload(message, eventType);
          detail = asString(complaint?.complaintFeedbackType) ?? "";
          break;
        }
        case "Click": {
          const click = getEventPayload(message, eventType);
          detail = asString(click?.link) ?? "";
          break;
        }
        case "Open": {
          const open = getEventPayload(message, eventType);
          detail = asString(open?.userAgent) ?? "";
          break;
        }
        case "Reject": {
          const reject = getEventPayload(message, eventType);
          detail = asString(reject?.reason) ?? "";
          break;
        }
        case "DeliveryDelay": {
          const delay = getEventPayload(message, eventType);
          const delayType = asString(delay?.delayType);
          const expirationTime = asString(delay?.expirationTime);
          detail = [delayType, expirationTime].filter(Boolean).join(" · ");
          break;
        }
        case "RenderingFailure": {
          const failure = getEventPayload(message, eventType);
          const templateName = asString(failure?.templateName);
          const errorMessage = asString(failure?.errorMessage);
          detail = [templateName, errorMessage].filter(Boolean).join(" · ");
          break;
        }
        case "Subscription": {
          const subscription = getEventPayload(message, eventType);
          detail = asString(subscription?.subscriptionType) ?? "";
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
