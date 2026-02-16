import { NextRequest, NextResponse } from "next/server";
import { listVerifiedDomains } from "@/lib/ses";
import {
  ensureWorkspaceMemberships,
  getAllWorkspaceSettings,
  getWorkspaceIdsForUser,
} from "@/lib/db";
import {
  apiErrorResponse,
  getInitialOwnerEmail,
  requireAuthenticatedUser,
} from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const domains = await listVerifiedDomains();
    if (user.email === getInitialOwnerEmail()) {
      // Preserve existing workspace data by claiming current SES domains
      // for the bootstrap owner account on first authenticated load.
      await ensureWorkspaceMemberships(user.id, domains, "owner");
    }

    const allowedWorkspaceIds = new Set(await getWorkspaceIdsForUser(user.id));
    const visibleDomains = domains.filter((domain) =>
      allowedWorkspaceIds.has(domain)
    );
    const settingsMap = new Map(
      (await getAllWorkspaceSettings()).map((s) => [s.id, s])
    );

    const workspaces = visibleDomains.map((domain) => {
      const saved = settingsMap.get(domain);
      return {
        id: domain,
        name: domain,
        from: saved?.from_address ?? `noreply@${domain}`,
        configSet: saved?.config_set ?? "email-tracking-config-set",
        rateLimit: saved?.rate_limit ?? 300,
      };
    });
    return NextResponse.json(workspaces);
  } catch (err) {
    return apiErrorResponse(err, "Failed to fetch SES domains");
  }
}
