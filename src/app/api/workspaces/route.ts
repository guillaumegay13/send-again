import { NextRequest, NextResponse } from "next/server";
import { listVerifiedDomains } from "@/lib/ses";
import {
  ensureWorkspaceMemberships,
  getAllWorkspaceSettings,
  getWorkspaceIdsForUser,
  getWorkspaceSettings,
} from "@/lib/db";
import {
  apiErrorResponse,
  getInitialOwnerEmail,
  requireAuthenticatedUser,
} from "@/lib/auth";

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

async function getVerifiedDomainsSafe(): Promise<string[]> {
  try {
    return await listVerifiedDomains();
  } catch (error) {
    console.error("Failed to load SES domains:", error);
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const domains = await getVerifiedDomainsSafe();
    if (user.email === getInitialOwnerEmail()) {
      // Preserve existing workspace data by claiming current SES domains
      // for the bootstrap owner account on first authenticated load.
      await ensureWorkspaceMemberships(user.id, domains, "owner");
    }

    const allowedWorkspaceIds = await getWorkspaceIdsForUser(user.id);
    const verifiedSet = new Set(domains.map((domain) => domain.toLowerCase()));
    const settingsMap = new Map(
      (await getAllWorkspaceSettings()).map((s) => [s.id, s])
    );

    const workspaces = allowedWorkspaceIds.map((workspaceId) => {
      const saved = settingsMap.get(workspaceId);
      return {
        id: workspaceId,
        name: workspaceId,
        from: saved?.from_address ?? `noreply@${workspaceId}`,
        configSet: saved?.config_set ?? "email-tracking-config-set",
        rateLimit: saved?.rate_limit ?? 300,
        footerHtml: saved?.footer_html ?? "",
        websiteUrl: saved?.website_url || `https://${workspaceId}`,
        contactSourceProvider: saved?.contact_source_provider ?? "manual",
        contactSourceConfig: saved?.contact_source_config ?? {},
        verified: verifiedSet.has(workspaceId.toLowerCase()),
      };
    });
    return NextResponse.json(workspaces);
  } catch (err) {
    return apiErrorResponse(err, "Failed to fetch SES domains");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = await req.json();
    const workspaceId = normalizeWorkspaceId(body?.id);
    if (!workspaceId) {
      return NextResponse.json(
        { error: "id must look like a domain (e.g. example.com)" },
        { status: 400 }
      );
    }

    await ensureWorkspaceMemberships(user.id, [workspaceId], "owner");
    const saved = await getWorkspaceSettings(workspaceId);
    const verifiedDomains = await getVerifiedDomainsSafe();
    const verifiedSet = new Set(
      verifiedDomains.map((domain) => domain.toLowerCase())
    );

    return NextResponse.json({
      id: workspaceId,
      name: workspaceId,
      from: saved?.from_address ?? `noreply@${workspaceId}`,
      configSet: saved?.config_set ?? "email-tracking-config-set",
      rateLimit: saved?.rate_limit ?? 300,
      footerHtml: saved?.footer_html ?? "",
      websiteUrl: saved?.website_url || `https://${workspaceId}`,
      contactSourceProvider: saved?.contact_source_provider ?? "manual",
      contactSourceConfig: saved?.contact_source_config ?? {},
      verified: verifiedSet.has(workspaceId),
    });
  } catch (err) {
    return apiErrorResponse(err, "Failed to add workspace");
  }
}
