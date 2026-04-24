import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";
import {
  getOrCreateWorkspaceBilling,
  upsertWorkspaceBilling,
} from "@/lib/db";
import { resolveWorkspaceBillingIdentity } from "@/lib/billing-auth";
import {
  billingStatusFromPolarSubscriptionStatus,
  getInitialFreeCredits,
  isBillingEnforced,
} from "@/lib/billing";
import { getPolarCustomerStateByExternalId, isPolarConfigured } from "@/lib/polar";

function isNotFoundError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("not found") || message.includes("404");
}

function isMissingBillingSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("workspace_billing") || message.includes("workspace_credit_grants");
}

export async function GET(req: NextRequest) {
  try {
    const workspaceParam = req.nextUrl.searchParams.get("workspace") ?? "";
    if (!workspaceParam.trim()) {
      return NextResponse.json(
        { error: "Missing workspace parameter" },
        { status: 400 }
      );
    }

    const auth = await requireWorkspaceAuth(req, workspaceParam, "send.read");
    const workspaceId = auth.workspace;
    const { billingBypass } = await resolveWorkspaceBillingIdentity(
      auth,
      workspaceId
    );

    // Keep local DB status aligned with Polar when possible.
    if (isPolarConfigured()) {
      try {
        const state = await getPolarCustomerStateByExternalId(workspaceId);
        const subscriptionStatus = state.activeSubscriptionStatus;

        await upsertWorkspaceBilling({
          workspaceId,
          billingStatus: billingStatusFromPolarSubscriptionStatus(subscriptionStatus),
          billingEmail: state.billingEmail,
          polarCustomerId: state.customerId,
          polarExternalCustomerId:
            state.externalCustomerId ?? `workspace:${workspaceId}`,
          polarSubscriptionId: state.activeSubscriptionId,
          polarSubscriptionStatus: subscriptionStatus,
          polarCurrentPeriodStart: state.currentPeriodStart,
          polarCurrentPeriodEnd: state.currentPeriodEnd,
          planName: subscriptionStatus ? "polar_metered" : "free",
        });
      } catch (error) {
        if (!isNotFoundError(error)) {
          console.error("Failed to sync Polar customer state:", error);
        }
      }
    }

    const billing = await getOrCreateWorkspaceBilling(workspaceId);

    return NextResponse.json({
      workspaceId,
      initialFreeCredits: getInitialFreeCredits(),
      creditsBalance: billing.creditBalance,
      creditsConsumed: billing.lifetimeCreditsConsumed,
      creditsPurchased: billing.lifetimeCreditsPurchased,
      billingEnforced: isBillingEnforced(),
      requiresTopUp: !billingBypass && billing.creditBalance <= 0,
      billingBypass,
      billing: {
        billingStatus: billing.billingStatus,
        billingEmail: billing.billingEmail,
        planName: billing.planName,
        creditBalance: billing.creditBalance,
        lifetimeCreditsPurchased: billing.lifetimeCreditsPurchased,
        lifetimeCreditsConsumed: billing.lifetimeCreditsConsumed,
        polarCustomerId: billing.polarCustomerId,
        polarExternalCustomerId: billing.polarExternalCustomerId,
        polarSubscriptionId: billing.polarSubscriptionId,
        polarSubscriptionStatus: billing.polarSubscriptionStatus,
        polarCurrentPeriodStart: billing.polarCurrentPeriodStart,
        polarCurrentPeriodEnd: billing.polarCurrentPeriodEnd,
        updatedAt: billing.updatedAt,
      },
    });
  } catch (error) {
    if (isMissingBillingSchemaError(error)) {
      return NextResponse.json(
        {
          error:
            "Billing storage is not initialized in Supabase. Run the latest supabase/schema.sql migration.",
        },
        { status: 503 }
      );
    }
    return apiErrorResponse(error, "Failed to fetch workspace billing status");
  }
}
