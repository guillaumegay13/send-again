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

function getProvidedToken(req: NextRequest): string | null {
  const headerToken = normalizeToken(req.headers.get("x-send-job-token"));
  if (headerToken) {
    return headerToken;
  }

  const authorization = normalizeToken(req.headers.get("authorization"));
  if (!authorization) {
    return null;
  }

  return normalizeToken(authorization.replace(/^Bearer\s+/i, ""));
}

export function isProcessorAuthorized(req: NextRequest): boolean {
  const configuredTokens = getConfiguredTokens();
  if (configuredTokens.length === 0) {
    return true;
  }

  const providedToken = getProvidedToken(req);
  return providedToken ? configuredTokens.includes(providedToken) : false;
}
