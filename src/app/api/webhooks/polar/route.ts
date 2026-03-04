import { NextRequest, NextResponse } from "next/server";
import { WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import {
  billingStatusFromPolarSubscriptionStatus,
  getCreditPacks,
  getPolarCreditMetadataKey,
} from "@/lib/billing";
import { applyWorkspaceCreditTopup, upsertWorkspaceBilling } from "@/lib/db";
import {
  polarExternalCustomerIdToWorkspace,
  validatePolarWebhookEvent,
} from "@/lib/polar";

export const runtime = "nodejs";

function toHeaderRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return null;
}

function resolveWorkspaceFromExternalCustomerId(
  value: unknown
): string | null {
  if (typeof value !== "string") return null;
  return polarExternalCustomerIdToWorkspace(value);
}

function toPositiveInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function getMetadataValueAsInt(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): number {
  if (!metadata || typeof metadata !== "object") return 0;
  return toPositiveInt(metadata[key]);
}

function getMetadataValueAsString(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): string {
  if (!metadata || typeof metadata !== "object") return "";
  const value = metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function resolveCreditsFromOrder(
  order: {
    productId: string | null;
    metadata: Record<string, unknown>;
    product: { id: string; metadata: Record<string, unknown> } | null;
  }
): number {
  const metadataKey = getPolarCreditMetadataKey();
  const configuredPacks = getCreditPacks();

  const metadataCredits =
    getMetadataValueAsInt(order.metadata, "credits") ||
    getMetadataValueAsInt(order.metadata, metadataKey);
  if (metadataCredits > 0) {
    return metadataCredits;
  }

  const packId = getMetadataValueAsString(order.metadata, "pack_id").toLowerCase();
  if (packId) {
    const matchedPack = configuredPacks.find((pack) => pack.id === packId);
    if (matchedPack) {
      return matchedPack.credits;
    }
  }

  const productId = order.product?.id ?? order.productId ?? "";
  if (productId) {
    const matchedPack = configuredPacks.find((pack) => pack.productId === productId);
    if (matchedPack) {
      return matchedPack.credits;
    }
  }

  const productMetadataCredits = getMetadataValueAsInt(
    order.product?.metadata,
    metadataKey
  );
  if (productMetadataCredits > 0) {
    return productMetadataCredits;
  }

  return 0;
}

export async function POST(req: NextRequest) {
  const body = await req.text();

  let event;
  try {
    event = validatePolarWebhookEvent(body, toHeaderRecord(req.headers));
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      return NextResponse.json({ error: "Invalid Polar webhook signature" }, { status: 403 });
    }
    console.error("Failed to verify Polar webhook:", error);
    return NextResponse.json({ error: "Invalid Polar webhook" }, { status: 400 });
  }

  try {
    if (
      event.type === "subscription.created" ||
      event.type === "subscription.updated" ||
      event.type === "subscription.active" ||
      event.type === "subscription.canceled" ||
      event.type === "subscription.uncanceled" ||
      event.type === "subscription.revoked"
    ) {
      const subscription = event.data;
      const customer = subscription.customer;
      const externalCustomerId = customer.externalId ?? null;
      const workspaceId = resolveWorkspaceFromExternalCustomerId(externalCustomerId);

      if (!workspaceId) {
        return NextResponse.json({ ok: true, ignored: true });
      }

      await upsertWorkspaceBilling({
        workspaceId,
        billingStatus: billingStatusFromPolarSubscriptionStatus(subscription.status),
        billingEmail: customer.email,
        polarCustomerId: customer.id,
        polarExternalCustomerId:
          externalCustomerId ?? `workspace:${workspaceId}`,
        polarSubscriptionId: subscription.id,
        polarSubscriptionStatus: subscription.status,
        polarCurrentPeriodStart: toIsoString(subscription.currentPeriodStart),
        polarCurrentPeriodEnd: toIsoString(subscription.currentPeriodEnd),
        planName: "polar_metered",
      });

      return NextResponse.json({ ok: true });
    }

    if (event.type === "order.paid") {
      const order = event.data;
      const externalCustomerId = order.customer.externalId ?? null;
      const workspaceId = resolveWorkspaceFromExternalCustomerId(externalCustomerId);

      if (!workspaceId) {
        return NextResponse.json({ ok: true, ignored: true });
      }

      const credits = resolveCreditsFromOrder({
        productId: order.productId,
        metadata: order.metadata as Record<string, unknown>,
        product: order.product
          ? {
              id: order.product.id,
              metadata: order.product.metadata as Record<string, unknown>,
            }
          : null,
      });

      await upsertWorkspaceBilling({
        workspaceId,
        billingEmail: order.customer.email,
        polarCustomerId: order.customer.id,
        polarExternalCustomerId: externalCustomerId ?? `workspace:${workspaceId}`,
      });

      if (credits <= 0) {
        return NextResponse.json({ ok: true, ignored: true, reason: "no_credit_mapping" });
      }

      const applied = await applyWorkspaceCreditTopup({
        workspaceId,
        sourceId: `polar_order:${order.id}`,
        credits,
        amountCents: toPositiveInt(order.totalAmount),
        currency: order.currency ?? "",
        metadata: {
          order_id: order.id,
          checkout_id: order.checkoutId ?? "",
          product_id: order.productId ?? "",
          credits,
        },
      });

      return NextResponse.json({ ok: true, credits, applied });
    }

    if (event.type === "customer.state_changed") {
      const state = event.data;
      const workspaceId = resolveWorkspaceFromExternalCustomerId(state.externalId);
      if (!workspaceId) {
        return NextResponse.json({ ok: true, ignored: true });
      }

      const activeSubscription = state.activeSubscriptions[0] ?? null;

      await upsertWorkspaceBilling({
        workspaceId,
        billingStatus: activeSubscription
          ? billingStatusFromPolarSubscriptionStatus(activeSubscription.status)
          : "inactive",
        billingEmail: state.email,
        polarCustomerId: state.id,
        polarExternalCustomerId: state.externalId ?? `workspace:${workspaceId}`,
        polarSubscriptionId: activeSubscription?.id ?? null,
        polarSubscriptionStatus: activeSubscription?.status ?? null,
        polarCurrentPeriodStart: toIsoString(activeSubscription?.currentPeriodStart),
        polarCurrentPeriodEnd: toIsoString(activeSubscription?.currentPeriodEnd),
        planName: activeSubscription ? "polar_metered" : "free",
      });

      return NextResponse.json({ ok: true });
    }

    if (event.type === "customer.created" || event.type === "customer.updated") {
      const customer = event.data;
      const workspaceId = resolveWorkspaceFromExternalCustomerId(customer.externalId);
      if (!workspaceId) {
        return NextResponse.json({ ok: true, ignored: true });
      }

      await upsertWorkspaceBilling({
        workspaceId,
        billingEmail: customer.email,
        polarCustomerId: customer.id,
        polarExternalCustomerId: customer.externalId ?? `workspace:${workspaceId}`,
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true, ignored: true });
  } catch (error) {
    console.error("Failed to process Polar webhook:", error);
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
  }
}
