import { createHmac, timingSafeEqual } from "node:crypto";

const REPLY_TRACKING_PREFIX = "reply";

function normalizeDomain(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
}

function getSigningSecret(): string {
  const secret =
    process.env.REPLY_TRACKING_SECRET ??
    process.env.OPEN_TRACKING_SECRET ??
    process.env.UNSUBSCRIBE_SECRET ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "Missing REPLY_TRACKING_SECRET, OPEN_TRACKING_SECRET, UNSUBSCRIBE_SECRET, or Supabase secret for reply tracking"
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

export function getReplyTrackingDomain(): string | null {
  const domain = normalizeDomain(process.env.REPLY_TRACKING_DOMAIN);
  return domain || null;
}

export function buildReplyTrackingAddress(recipientId: number): string | null {
  const domain = getReplyTrackingDomain();
  if (!domain) return null;
  return `${REPLY_TRACKING_PREFIX}+${normalizeRecipientId(recipientId)}.${computeToken(recipientId)}@${domain}`;
}

export function verifyReplyTrackingAddress(
  address: string
): { recipientId: number } | null {
  const normalizedAddress = address.trim().toLowerCase();
  if (!normalizedAddress) return null;

  const domain = getReplyTrackingDomain();
  if (!domain) return null;

  const [localPart, addressDomain] = normalizedAddress.split("@");
  if (!localPart || !addressDomain || addressDomain !== domain) {
    return null;
  }

  const match = localPart.match(/^reply\+(\d+)\.([a-f0-9]{64})$/i);
  if (!match) return null;

  const recipientId = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(recipientId) || recipientId <= 0) {
    return null;
  }

  const token = match[2];
  const expected = computeToken(recipientId);
  const tokenBuffer = Buffer.from(token, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (tokenBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(tokenBuffer, expectedBuffer)) {
    return null;
  }

  return { recipientId };
}
