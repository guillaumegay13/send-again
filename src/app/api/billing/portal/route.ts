import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { userIsWorkspaceOwner } from "@/lib/db";
import { createPolarCustomerPortalSession, isPolarConfigured } from "@/lib/polar";

interface PortalBody {
  workspaceId: string;
  returnUrl?: string;
}

function normalizeWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!normalized.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(normalized)) return null;
  if (normalized.startsWith(".") || normalized.endsWith(".")) return null;
  if (normalized.includes("..")) return null;
  return normalized;
}

function normalizeBody(raw: unknown): PortalBody {
  const body = (raw ?? {}) as Record<string, unknown>;
  return {
    workspaceId: String(body.workspaceId ?? "").trim().toLowerCase(),
    returnUrl: typeof body.returnUrl === "string" ? body.returnUrl.trim() : "",
  };
}

function normalizeReturnUrl(
  value: string | undefined,
  fallback: string,
  expectedOrigin: string
): string {
  if (!value) return fallback;

  try {
    const parsed = new URL(value);
    if (parsed.origin !== expectedOrigin) {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

function getStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== "number") return null;
  if (!Number.isFinite(statusCode)) return null;
  return statusCode;
}

function isNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("not found");
}

export async function POST(req: NextRequest) {
  try {
    if (!isPolarConfigured()) {
      return NextResponse.json(
        { error: "Polar billing is not configured on the server" },
        { status: 503 }
      );
    }

    const user = await requireAuthenticatedUser(req);
    const body = normalizeBody(await req.json());
    const workspaceId = normalizeWorkspaceId(body.workspaceId);
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId must look like a domain (e.g. example.com)" },
        { status: 400 }
      );
    }

    const isOwner = await userIsWorkspaceOwner(user.id, workspaceId);
    if (!isOwner) {
      return NextResponse.json(
        { error: "Only workspace owners can manage billing" },
        { status: 403 }
      );
    }

    const appBaseUrl =
      process.env.APP_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      req.nextUrl.origin;

    const returnUrl = normalizeReturnUrl(
      body.returnUrl,
      `${appBaseUrl}/?billing=portal-return`,
      new URL(appBaseUrl).origin
    );

    const session = await createPolarCustomerPortalSession({
      workspaceId,
      returnUrl,
    });

    return NextResponse.json({
      customerPortalUrl: session.customerPortalUrl,
      externalCustomerId: session.externalCustomerId,
    });
  } catch (error) {
    const statusCode = getStatusCode(error);
    if (statusCode === 404 || isNotFoundError(error)) {
      return NextResponse.json(
        {
          error:
            "No Polar customer exists yet for this workspace. Complete one credit purchase first, then Manage billing will work.",
        },
        { status: 409 }
      );
    }
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json(
        {
          error:
            "Polar access token is missing permission for customer sessions. Ensure it includes customer_sessions:write.",
        },
        { status: 503 }
      );
    }
    return apiErrorResponse(error, "Failed to create Polar customer session");
  }
}
