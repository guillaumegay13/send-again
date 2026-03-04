import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getCreditPackById, getCreditPacks } from "@/lib/billing";
import {
  getOrCreateWorkspaceBilling,
  upsertWorkspaceBilling,
  userIsWorkspaceOwner,
} from "@/lib/db";
import { createPolarCheckoutSession, isPolarConfigured } from "@/lib/polar";

interface CheckoutBody {
  workspaceId: string;
  packId?: string;
  successUrl?: string;
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

function normalizeCheckoutBody(raw: unknown): CheckoutBody {
  const body = (raw ?? {}) as Record<string, unknown>;
  return {
    workspaceId: String(body.workspaceId ?? "").trim().toLowerCase(),
    packId: typeof body.packId === "string" ? body.packId.trim().toLowerCase() : "",
    successUrl: typeof body.successUrl === "string" ? body.successUrl.trim() : "",
    returnUrl: typeof body.returnUrl === "string" ? body.returnUrl.trim() : "",
  };
}

function normalizeUrl(
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

function extractPolarErrorDetail(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const body = (error as { body?: unknown }).body;
  if (typeof body !== "string" || !body.trim()) return "";

  try {
    const parsed = JSON.parse(body) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };

    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }
    if (Array.isArray(parsed.detail)) {
      const first = parsed.detail[0];
      if (first && typeof first === "object" && "msg" in first) {
        const msg = (first as { msg?: unknown }).msg;
        if (typeof msg === "string" && msg.trim()) {
          return msg.trim();
        }
      }
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    return "";
  }

  return "";
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
    const body = normalizeCheckoutBody(await req.json());
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

    const availablePacks = getCreditPacks();
    const packId = (body.packId ?? "").trim().toLowerCase();
    const selectedPack = getCreditPackById(packId) ?? availablePacks[0] ?? null;
    if (!selectedPack) {
      return NextResponse.json(
        {
          error: "Invalid or missing credit pack",
          availablePacks: availablePacks.map((pack) => ({
            id: pack.id,
            name: pack.name,
            credits: pack.credits,
            amountCents: pack.amountCents,
            currency: pack.currency,
          })),
        },
        { status: 400 }
      );
    }

    const appBaseUrl =
      process.env.APP_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      req.nextUrl.origin;

    const successUrl = normalizeUrl(
      body.successUrl,
      `${appBaseUrl}/?billing=success`,
      new URL(appBaseUrl).origin
    );
    const returnUrl = normalizeUrl(
      body.returnUrl,
      `${appBaseUrl}/?billing=back`,
      new URL(appBaseUrl).origin
    );

    const billing = await getOrCreateWorkspaceBilling(workspaceId);
    const checkout = await createPolarCheckoutSession({
      workspaceId,
      productId: selectedPack.productId,
      customerEmail: user.email,
      successUrl,
      returnUrl,
      amountCents: selectedPack.amountCents,
      currency: selectedPack.currency,
      metadata: {
        pack_id: selectedPack.id,
        credits: selectedPack.credits,
      },
    });

    await upsertWorkspaceBilling({
      workspaceId,
      billingEmail: user.email,
      polarExternalCustomerId:
        billing.polarExternalCustomerId || checkout.externalCustomerId,
      planName: billing.planName || "free",
    });

    return NextResponse.json({
      checkoutId: checkout.checkoutId,
      checkoutUrl: checkout.checkoutUrl,
      externalCustomerId: checkout.externalCustomerId,
      pack: {
        id: selectedPack.id,
        name: selectedPack.name,
        credits: selectedPack.credits,
        amountCents: selectedPack.amountCents,
        currency: selectedPack.currency,
      },
    });
  } catch (error) {
    const statusCode = getStatusCode(error);
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json(
        {
          error:
            "Polar access token rejected checkout creation. Ensure POLAR_ACCESS_TOKEN is valid for the selected POLAR_SERVER and includes checkouts:write.",
        },
        { status: 503 }
      );
    }
    if (statusCode === 404 || isNotFoundError(error)) {
      return NextResponse.json(
        {
          error:
            "Polar product was not found. Check POLAR_CREDIT_PACKS_JSON productId values and confirm they belong to the current POLAR_SERVER (sandbox vs production).",
        },
        { status: 409 }
      );
    }
    if (statusCode === 422) {
      const detail = extractPolarErrorDetail(error);
      return NextResponse.json(
        {
          error: detail
            ? `Polar rejected checkout payload: ${detail}`
            : "Polar rejected checkout payload. Verify product setup and checkout parameters in Polar.",
        },
        { status: 400 }
      );
    }
    return apiErrorResponse(error, "Failed to create Polar checkout session");
  }
}
