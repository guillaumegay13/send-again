import { createHmac, timingSafeEqual } from "crypto";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeWorkspaceId(value: string): string {
  return value.trim().toLowerCase();
}

function getSigningSecret(): string {
  const secret =
    process.env.UNSUBSCRIBE_SECRET ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "Missing UNSUBSCRIBE_SECRET or SUPABASE secret for unsubscribe links"
    );
  }
  return secret;
}

function computeToken(workspaceId: string, email: string): string {
  const payload = `${normalizeWorkspaceId(workspaceId)}\n${normalizeEmail(email)}`;
  return createHmac("sha256", getSigningSecret()).update(payload).digest("hex");
}

export function createUnsubscribeToken(workspaceId: string, email: string): string {
  return computeToken(workspaceId, email);
}

export function verifyUnsubscribeToken(
  workspaceId: string,
  email: string,
  token: string
): boolean {
  if (!token || token.length !== 64 || !/^[a-f0-9]+$/i.test(token)) {
    return false;
  }

  const expected = computeToken(workspaceId, email);
  const tokenBuffer = Buffer.from(token, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (tokenBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(tokenBuffer, expectedBuffer);
}

export function buildUnsubscribeUrl({
  baseUrl,
  workspaceId,
  email,
}: {
  baseUrl: string;
  workspaceId: string;
  email: string;
}): string {
  const token = createUnsubscribeToken(workspaceId, email);
  const url = new URL("/api/unsubscribe", baseUrl);
  url.searchParams.set("workspace", normalizeWorkspaceId(workspaceId));
  url.searchParams.set("email", email.trim());
  url.searchParams.set("token", token);
  return url.toString();
}
