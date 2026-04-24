import { after, NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceBillingIdentity } from "@/lib/billing-auth";
import { startCampaignRun } from "@/lib/campaign-runtime";
import { drainBackgroundWork } from "@/lib/background-processors";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as {
      workspaceId?: unknown;
    };
    const requestedWorkspaceId = String(body.workspaceId ?? "")
      .trim()
      .toLowerCase();
    const auth = await requireWorkspaceAuth(
      req,
      requestedWorkspaceId || null,
      "send.write"
    );
    const workspaceId = auth.workspace;
    if (
      auth.authMethod === "api_key" &&
      requestedWorkspaceId &&
      requestedWorkspaceId !== workspaceId
    ) {
      return NextResponse.json(
        { error: "workspaceId does not match API key workspace" },
        { status: 400 }
      );
    }

    const billingIdentity = await resolveWorkspaceBillingIdentity(
      auth,
      workspaceId
    );
    const userId = billingIdentity.userId;
    if (!userId) {
      return NextResponse.json(
        {
          error:
            "Workspace has no linked members; cannot attribute campaign ownership",
        },
        { status: 400 }
      );
    }

    const result = await startCampaignRun({
      workspaceId,
      campaignId: id,
      userId,
      billingBypass: billingIdentity.billingBypass,
    });

    after(async () => {
      try {
        await drainBackgroundWork(10);
      } catch (error) {
        console.error("Background campaign processing error:", error);
      }
    });

    return NextResponse.json({
      runId: result.runId,
      rootSteps: result.rootSteps,
      status: "queued",
    });
  } catch (error) {
    return apiErrorResponse(error, "Failed to start campaign");
  }
}
