import { NextRequest, NextResponse } from "next/server";
import {
  getCampaignRunForUser,
  getCampaignRunForWorkspace,
} from "@/lib/campaign-db";
import { processCampaignRuns } from "@/lib/campaign-runtime";
import { processSendJobs } from "@/lib/send-job-processor";
import {
  apiErrorResponse,
  requireAuthenticatedUser,
  requireWorkspaceAuth,
} from "@/lib/auth";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const authHeader = req.headers.get("authorization") ?? "";
    const isApiKeyAuth =
      authHeader.startsWith("Bearer ") &&
      authHeader.slice("Bearer ".length).trim().startsWith("sk_");

    const workspaceId = isApiKeyAuth
      ? (req.nextUrl.searchParams.get("workspace")?.trim().toLowerCase() ?? "")
      : null;
    if (isApiKeyAuth && !workspaceId) {
      return NextResponse.json(
        { error: "Missing workspace parameter" },
        { status: 400 }
      );
    }

    const apiKeyWorkspace = isApiKeyAuth
      ? (await requireWorkspaceAuth(req, workspaceId, "send.read")).workspace
      : null;
    const jwtUserId = isApiKeyAuth
      ? null
      : (await requireAuthenticatedUser(req)).id;

    let progress = null;
    if (apiKeyWorkspace) {
      progress = await getCampaignRunForWorkspace(id, apiKeyWorkspace);
    } else if (jwtUserId) {
      progress = await getCampaignRunForUser(id, jwtUserId);
    }

    if (!progress) {
      return NextResponse.json({ error: "Campaign run not found" }, { status: 404 });
    }

    if (["queued", "running", "waiting"].includes(progress.status)) {
      try {
        await processCampaignRuns({
          maxPendingSteps: 10,
          maxWaitingSteps: 10,
        });
        await processSendJobs({
          maxJobs: 3,
          maxRecipientsPerJob: 50,
        });
      } catch (error) {
        console.error("Inline campaign processing from status route failed:", error);
      }

      if (apiKeyWorkspace) {
        const refreshed = await getCampaignRunForWorkspace(id, apiKeyWorkspace);
        if (refreshed) {
          progress = refreshed;
        }
      } else if (jwtUserId) {
        const refreshed = await getCampaignRunForUser(id, jwtUserId);
        if (refreshed) {
          progress = refreshed;
        }
      }
    }

    return NextResponse.json({
      ...progress,
      isDone: ["completed", "failed", "cancelled"].includes(progress.status),
    });
  } catch (error) {
    return apiErrorResponse(error, "Failed to read campaign run status");
  }
}
