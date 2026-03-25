import { NextRequest, NextResponse } from "next/server";
import {
  listCampaignWorkflows,
  upsertCampaignWorkflow,
} from "@/lib/campaign-db";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";
import { normalizeCampaign } from "@/lib/campaign-workflows";

export async function GET(req: NextRequest) {
  try {
    const workspaceId =
      req.nextUrl.searchParams.get("workspace")?.trim().toLowerCase() ?? "";
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing workspace parameter" },
        { status: 400 }
      );
    }

    await requireWorkspaceAuth(req, workspaceId);
    const items = await listCampaignWorkflows(workspaceId);
    return NextResponse.json({ items });
  } catch (error) {
    return apiErrorResponse(error, "Failed to list campaigns");
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      workspaceId?: unknown;
      draft?: unknown;
    };
    const workspaceId = String(body.workspaceId ?? "").trim().toLowerCase();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing workspaceId" },
        { status: 400 }
      );
    }

    await requireWorkspaceAuth(req, workspaceId);
    const draft = normalizeCampaign(body.draft);
    if (!draft) {
      return NextResponse.json(
        { error: "Invalid campaign payload" },
        { status: 400 }
      );
    }

    const item = await upsertCampaignWorkflow({
      workspaceId,
      draft,
    });
    return NextResponse.json(item);
  } catch (error) {
    return apiErrorResponse(error, "Failed to save campaign");
  }
}
