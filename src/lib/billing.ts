export type WorkspaceBillingStatus =
  | "inactive"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid";

export interface CreditPack {
  id: string;
  name: string;
  productId: string;
  credits: number;
  amountCents: number;
  currency: string;
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalizePackId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function normalizeCurrency(value: unknown): string {
  if (typeof value !== "string") return "usd";
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "usd";
  if (!/^[a-z]{3}$/.test(normalized)) return "usd";
  return normalized;
}

function inferAmountCentsFromName(name: string): number {
  const match = name.match(/([$€£])?\s*([0-9]+(?:[.,][0-9]{1,2})?)/);
  if (!match) return 0;
  const numeric = Number(match[2].replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(1, Math.round(numeric * 100));
}

function amountToCents(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(1, Math.round(parsed * 100));
}

export function isBillingEnforced(): boolean {
  return isTruthy(process.env.BILLING_ENFORCED);
}

export function isBillingEnabled(): boolean {
  if (isBillingEnforced()) return true;
  const polarToken = process.env.POLAR_ACCESS_TOKEN?.trim();
  return Boolean(polarToken);
}

export function getInitialFreeCredits(): number {
  const parsed = Number(process.env.FREE_TIER_INITIAL_CREDITS ?? "1000");
  if (!Number.isFinite(parsed)) return 1000;
  return Math.max(0, Math.floor(parsed));
}

export function getPolarCreditMetadataKey(): string {
  const key = process.env.POLAR_CREDIT_METADATA_KEY?.trim();
  return key || "email_credits";
}

export function normalizeBillingStatus(value: unknown): WorkspaceBillingStatus {
  if (value === "active") return "active";
  if (value === "trialing") return "trialing";
  if (value === "past_due") return "past_due";
  if (value === "canceled") return "canceled";
  if (value === "unpaid") return "unpaid";
  return "inactive";
}

export function billingStatusFromPolarSubscriptionStatus(
  status: string | null | undefined
): WorkspaceBillingStatus {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "active") return "active";
  if (normalized === "trialing") return "trialing";
  if (normalized === "past_due") return "past_due";
  if (normalized === "unpaid") return "unpaid";
  if (normalized === "canceled") return "canceled";
  return "inactive";
}

export function getCreditPacks(): CreditPack[] {
  const configured = process.env.POLAR_CREDIT_PACKS_JSON?.trim();

  if (configured) {
    try {
      const raw = JSON.parse(configured);
      if (!Array.isArray(raw)) {
        return [];
      }

      const packs: CreditPack[] = [];
      for (const entry of raw) {
        const row =
          entry && typeof entry === "object" && !Array.isArray(entry)
            ? (entry as Record<string, unknown>)
            : {};

        const id = normalizePackId(row.id);
        const name =
          typeof row.name === "string" && row.name.trim()
            ? row.name.trim().slice(0, 120)
            : "Credit Pack";
        const productId =
          typeof row.productId === "string" ? row.productId.trim() : "";
        const credits = toPositiveInt(row.credits, 0);
        const explicitAmountCents = toPositiveInt(row.amountCents, 0);
        const explicitAmount = amountToCents(row.amount);
        const inferredAmountCents = inferAmountCentsFromName(name);
        const defaultAmountCents = toPositiveInt(
          process.env.POLAR_DEFAULT_PACK_AMOUNT_CENTS ?? "1000",
          1000
        );
        const amountCents =
          explicitAmountCents > 0
            ? explicitAmountCents
            : explicitAmount > 0
            ? explicitAmount
            : inferredAmountCents > 0
            ? inferredAmountCents
            : defaultAmountCents;
        const currency = normalizeCurrency(row.currency);

        if (!id || !productId || credits <= 0 || amountCents <= 0) {
          continue;
        }

        packs.push({ id, name, productId, credits, amountCents, currency });
      }

      return packs;
    } catch {
      return [];
    }
  }

  const fallbackProductId = process.env.POLAR_PRODUCT_ID?.trim();
  if (!fallbackProductId) {
    return [];
  }

  return [
    {
      id: "topup",
      name: "Credit Top-up",
      productId: fallbackProductId,
      credits: toPositiveInt(process.env.POLAR_DEFAULT_PACK_CREDITS ?? "10000", 10000),
      amountCents: toPositiveInt(
        process.env.POLAR_DEFAULT_PACK_AMOUNT_CENTS ?? "1000",
        1000
      ),
      currency: normalizeCurrency(process.env.POLAR_DEFAULT_PACK_CURRENCY ?? "usd"),
    },
  ];
}

export function getCreditPackById(packId: string): CreditPack | null {
  const normalizedPackId = normalizePackId(packId);
  if (!normalizedPackId) return null;

  const packs = getCreditPacks();
  return packs.find((pack) => pack.id === normalizedPackId) ?? null;
}
