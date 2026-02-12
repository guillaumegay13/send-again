import { NextResponse } from "next/server";
import { listVerifiedDomains } from "@/lib/ses";

export async function GET() {
  try {
    const domains = await listVerifiedDomains();
    const workspaces = domains.map((domain) => ({
      id: domain,
      name: domain,
      from: `noreply@${domain}`,
      configSet: "email-tracking-config-set",
      rateLimit: 300,
    }));
    return NextResponse.json(workspaces);
  } catch (err) {
    console.error("Failed to list SES domains:", err);
    return NextResponse.json(
      { error: "Failed to fetch SES domains" },
      { status: 500 }
    );
  }
}
