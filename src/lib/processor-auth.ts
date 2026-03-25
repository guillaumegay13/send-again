import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

function normalizeToken(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getConfiguredTokens(): string[] {
  return Array.from(
    new Set(
      [
        normalizeToken(process.env.SEND_JOB_PROCESSOR_TOKEN),
        normalizeToken(process.env.CRON_SECRET),
      ].filter((value): value is string => Boolean(value))
    )
  );
}

function getAuthorizationToken(req: NextRequest): string | null {
  const authorization = normalizeToken(req.headers.get("authorization"));
  if (!authorization) {
    return null;
  }

  return normalizeToken(authorization.replace(/^Bearer\s+/i, ""));
}

function getProvidedToken(req: NextRequest): string | null {
  const headerToken = normalizeToken(req.headers.get("x-send-job-token"));
  if (headerToken) {
    return headerToken;
  }

  return getAuthorizationToken(req);
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function matchesAnyToken(providedToken: string | null, expectedTokens: string[]): boolean {
  if (!providedToken) {
    return false;
  }

  let matched = false;
  for (const expectedToken of expectedTokens) {
    if (constantTimeEquals(providedToken, expectedToken)) {
      matched = true;
    }
  }
  return matched;
}

export function isProcessorAuthorized(req: NextRequest): boolean {
  const configuredTokens = getConfiguredTokens();
  if (configuredTokens.length === 0) {
    return true;
  }

  const providedToken = getProvidedToken(req);
  return matchesAnyToken(providedToken, configuredTokens);
}

export function isVercelCronAuthorized(req: NextRequest): boolean {
  const cronSecret = normalizeToken(process.env.CRON_SECRET);
  if (!cronSecret) {
    return false;
  }

  return matchesAnyToken(getAuthorizationToken(req), [cronSecret]);
}
