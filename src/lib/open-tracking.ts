import { createHmac, timingSafeEqual } from "node:crypto";

function getSigningSecret(): string {
  const secret =
    process.env.OPEN_TRACKING_SECRET ??
    process.env.UNSUBSCRIBE_SECRET ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "Missing OPEN_TRACKING_SECRET, UNSUBSCRIBE_SECRET, or Supabase secret for open tracking"
    );
  }
  return secret;
}

function normalizeRecipientId(recipientId: number): string {
  if (!Number.isSafeInteger(recipientId) || recipientId <= 0) {
    throw new Error("Invalid send job recipient id");
  }
  return String(recipientId);
}

function computeToken(recipientId: number): string {
  return createHmac("sha256", getSigningSecret())
    .update(normalizeRecipientId(recipientId))
    .digest("hex");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function createOpenTrackingToken(recipientId: number): string {
  return computeToken(recipientId);
}

export function verifyOpenTrackingToken(
  recipientId: number,
  token: string
): boolean {
  if (!token || token.length !== 64 || !/^[a-f0-9]+$/i.test(token)) {
    return false;
  }

  const expected = computeToken(recipientId);
  const tokenBuffer = Buffer.from(token, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(tokenBuffer, expectedBuffer);
}

export function buildOpenTrackingUrl({
  baseUrl,
  recipientId,
}: {
  baseUrl: string;
  recipientId: number;
}): string {
  const url = new URL("/api/track/open", baseUrl);
  url.searchParams.set("id", normalizeRecipientId(recipientId));
  url.searchParams.set("token", createOpenTrackingToken(recipientId));
  return url.toString();
}

export function appendOpenTrackingPixel({
  html,
  trackingUrl,
}: {
  html: string;
  trackingUrl: string;
}): string {
  const pixel = `<img src="${escapeHtmlAttribute(trackingUrl)}" alt="" aria-hidden="true" width="1" height="1" style="display:block;border:0;outline:none;text-decoration:none;width:1px;height:1px;opacity:0" />`;

  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${pixel}</body>`);
  }

  return `${html}${pixel}`;
}
