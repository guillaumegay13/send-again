import { NextResponse } from "next/server";
import { listVerifiedDomains } from "@/lib/ses";
import { getAllWorkspaceSettings } from "@/lib/db";

export async function GET() {
  try {
    const domains = await listVerifiedDomains();
    const settingsMap = new Map(
      getAllWorkspaceSettings().map((s) => [s.id, s])
    );

    const workspaces = domains.map((domain) => {
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
    console.error("Failed to list SES domains:", err);
    return NextResponse.json(
      { error: "Failed to fetch SES domains" },
      { status: 500 }
    );
  }
}
