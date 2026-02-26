import { NextRequest, NextResponse } from "next/server";
import {
  verifyDomain,
  getDomainSetupStatus,
  setupDkim,
  createConfigurationSet,
  configurationSetExists,
} from "@/lib/ses";
import { requireAuthenticatedUser, apiErrorResponse } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticatedUser(req);

    const domain = req.nextUrl.searchParams.get("domain");
    if (!domain) {
      return NextResponse.json(
        { error: "domain query parameter is required" },
        { status: 400 }
      );
    }

    const configSetName = req.nextUrl.searchParams.get("configSet") ?? "";

    const [status, configSetExists_] = await Promise.all([
      getDomainSetupStatus(domain),
      configSetName ? configurationSetExists(configSetName) : Promise.resolve(false),
    ]);

    return NextResponse.json({
      verificationToken: status.verificationToken,
      verificationStatus: status.verificationStatus,
      dkimTokens: status.dkimTokens,
      dkimStatus: status.dkimStatus,
      configSetExists: configSetExists_,
    });
  } catch (err) {
    return apiErrorResponse(err, "Failed to get setup status");
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuthenticatedUser(req);

    const body = await req.json();
    const { domain, action, configSet } = body as {
      domain?: string;
      action?: string;
      configSet?: string;
    };

    if (!domain) {
      return NextResponse.json(
        { error: "domain is required" },
        { status: 400 }
      );
    }

    switch (action) {
      case "verify-domain": {
        const token = await verifyDomain(domain);
        return NextResponse.json({ token });
      }
      case "setup-dkim": {
        const tokens = await setupDkim(domain);
        return NextResponse.json({ dkimTokens: tokens });
      }
      case "create-config-set": {
        if (!configSet) {
          return NextResponse.json(
            { error: "configSet is required for this action" },
            { status: 400 }
          );
        }
        await createConfigurationSet(configSet);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return apiErrorResponse(err, "Setup action failed");
  }
}
