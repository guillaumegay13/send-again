import { Polar } from "@polar-sh/sdk";
import { validateEvent } from "@polar-sh/sdk/webhooks";

const globalPolar = globalThis as unknown as {
  __polarClient?: Polar;
};

function getPolarServer(): "sandbox" | "production" {
  const raw = (process.env.POLAR_SERVER ?? "sandbox").trim().toLowerCase();
  if (raw === "production") return "production";
  return "sandbox";
}

function getPolarAccessToken(): string {
  const token = process.env.POLAR_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error("Missing environment variable: POLAR_ACCESS_TOKEN");
  }
  return token;
}

function getPolarWebhookSecret(): string {
  const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing environment variable: POLAR_WEBHOOK_SECRET");
  }
  return secret;
}

export function isPolarConfigured(): boolean {
  return Boolean(process.env.POLAR_ACCESS_TOKEN?.trim());
}

function getPolarClient(): Polar {
  if (!globalPolar.__polarClient) {
    globalPolar.__polarClient = new Polar({
      accessToken: getPolarAccessToken(),
      server: getPolarServer(),
    });
  }

  return globalPolar.__polarClient;
}

export function workspaceToPolarExternalCustomerId(workspaceId: string): string {
  return `workspace:${workspaceId.trim().toLowerCase()}`;
}

export function polarExternalCustomerIdToWorkspace(
  externalCustomerId: string | null | undefined
): string | null {
  const value = (externalCustomerId ?? "").trim().toLowerCase();
  if (!value.startsWith("workspace:")) return null;

  const workspaceId = value.slice("workspace:".length).trim();
  if (!workspaceId) return null;
  if (!workspaceId.includes(".")) return null;
  if (!/^[a-z0-9.-]+$/.test(workspaceId)) return null;
  if (workspaceId.startsWith(".") || workspaceId.endsWith(".")) return null;
  if (workspaceId.includes("..")) return null;

  return workspaceId;
}

function getPolarErrorStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== "number" || !Number.isFinite(statusCode)) return null;
  return statusCode;
}

function getPolarErrorBody(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const body = (error as { body?: unknown }).body;
  return typeof body === "string" ? body : "";
}

function shouldRetryCheckoutWithoutCustomerEmail(error: unknown): boolean {
  const statusCode = getPolarErrorStatusCode(error);
  if (statusCode !== 422) return false;
  const body = getPolarErrorBody(error).toLowerCase();
  if (!body) return false;
  if (!body.includes("customer_email")) return false;
  return (
    body.includes("not a valid email address") ||
    body.includes("does not accept email")
  );
}

export async function createPolarCheckoutSession(params: {
  workspaceId: string;
  productId: string;
  customerEmail: string;
  successUrl: string;
  returnUrl: string;
  amountCents?: number;
  currency?: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<{ checkoutId: string; checkoutUrl: string; externalCustomerId: string }> {
  const polar = getPolarClient();
  const externalCustomerId = workspaceToPolarExternalCustomerId(params.workspaceId);
  const normalizedAmountCents = Math.max(
    0,
    Math.floor(Number(params.amountCents ?? 0))
  );
  const prices =
    normalizedAmountCents > 0
      ? {
          [params.productId]: [
            {
              amountType: "fixed" as const,
              priceAmount: normalizedAmountCents,
            },
          ],
        }
      : undefined;
  const basePayload = {
    products: [params.productId],
    prices,
    allowDiscountCodes: false,
    externalCustomerId,
    successUrl: params.successUrl,
    returnUrl: params.returnUrl,
    metadata: {
      workspace_id: params.workspaceId,
      ...(params.metadata ?? {}),
    },
    customerMetadata: {
      workspace_id: params.workspaceId,
    },
  };

  let checkout;
  try {
    checkout = await polar.checkouts.create({
      ...basePayload,
      customerEmail: params.customerEmail,
    });
  } catch (error) {
    if (!shouldRetryCheckoutWithoutCustomerEmail(error)) {
      throw error;
    }
    checkout = await polar.checkouts.create(basePayload);
  }

  return {
    checkoutId: checkout.id,
    checkoutUrl: checkout.url,
    externalCustomerId,
  };
}

export async function createPolarCustomerPortalSession(params: {
  workspaceId: string;
  returnUrl: string;
}): Promise<{ customerPortalUrl: string; externalCustomerId: string }> {
  const polar = getPolarClient();
  const externalCustomerId = workspaceToPolarExternalCustomerId(params.workspaceId);

  const session = await polar.customerSessions.create({
    externalCustomerId,
    returnUrl: params.returnUrl,
  });

  return {
    customerPortalUrl: session.customerPortalUrl,
    externalCustomerId,
  };
}

export async function getPolarCustomerStateByExternalId(
  workspaceId: string
): Promise<{
  customerId: string;
  externalCustomerId: string | null;
  billingEmail: string;
  activeSubscriptionId: string | null;
  activeSubscriptionStatus: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}> {
  const polar = getPolarClient();
  const state = await polar.customers.getStateExternal({
    externalId: workspaceToPolarExternalCustomerId(workspaceId),
  });

  const activeSubscription = state.activeSubscriptions[0] ?? null;

  return {
    customerId: state.id,
    externalCustomerId: state.externalId ?? null,
    billingEmail: state.email,
    activeSubscriptionId: activeSubscription?.id ?? null,
    activeSubscriptionStatus: activeSubscription?.status ?? null,
    currentPeriodStart: activeSubscription?.currentPeriodStart
      ? activeSubscription.currentPeriodStart.toISOString()
      : null,
    currentPeriodEnd: activeSubscription?.currentPeriodEnd
      ? activeSubscription.currentPeriodEnd.toISOString()
      : null,
  };
}

export type PolarWebhookEvent = ReturnType<typeof validateEvent>;

export function validatePolarWebhookEvent(
  body: string,
  headers: Record<string, string>
): PolarWebhookEvent {
  return validateEvent(body, headers, getPolarWebhookSecret());
}
