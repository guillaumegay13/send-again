import { after, NextRequest, NextResponse } from "next/server";
import { getPreferredWorkspaceUserId } from "@/lib/db";
import { isBillingUnlimitedForUser } from "@/lib/billing";
import { processSendJobs } from "@/lib/send-job-processor";
import { processCampaignRuns, startCampaignRun } from "@/lib/campaign-runtime";
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
    const workspaceId = String(body.workspaceId ?? "").trim().toLowerCase();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing workspaceId" },
        { status: 400 }
      );
    }

    const auth = await requireWorkspaceAuth(req, workspaceId, "send.write");
    let userId = auth.userId ?? null;
    if (!userId) {
      userId = await getPreferredWorkspaceUserId(workspaceId);
    }
    if (!userId) {
      return NextResponse.json(
        {
          error:
            "Workspace has no linked members; cannot attribute campaign ownership",
        },
        { status: 400 }
      );
    }

    const billingBypass = isBillingUnlimitedForUser({
      userId,
      email: auth.userEmail ?? null,
    });

    const result = await startCampaignRun({
      workspaceId,
      campaignId: id,
      userId,
      billingBypass,
    });

    after(async () => {
      try {
        await processCampaignRuns({
          maxPendingSteps: 10,
          maxWaitingSteps: 10,
        });
        await processSendJobs();
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
