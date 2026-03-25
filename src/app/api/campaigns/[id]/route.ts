import { NextRequest, NextResponse } from "next/server";
import {
  deleteCampaignWorkflow,
  getCampaignWorkflowForWorkspace,
  upsertCampaignWorkflow,
} from "@/lib/campaign-db";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";
import { normalizeCampaign } from "@/lib/campaign-workflows";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const workspaceId =
      req.nextUrl.searchParams.get("workspace")?.trim().toLowerCase() ?? "";
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing workspace parameter" },
        { status: 400 }
      );
    }

    await requireWorkspaceAuth(req, workspaceId);
    const item = await getCampaignWorkflowForWorkspace(workspaceId, id);
    if (!item) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    return apiErrorResponse(error, "Failed to read campaign");
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
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
    const draft = normalizeCampaign({
      ...(typeof body.draft === "object" && body.draft ? body.draft : {}),
      campaignId: id,
    });
    if (!draft) {
      return NextResponse.json(
        { error: "Invalid campaign payload" },
        { status: 400 }
      );
    }

    const item = await upsertCampaignWorkflow({
      workspaceId,
      draft: { ...draft, campaignId: id },
    });
    return NextResponse.json(item);
  } catch (error) {
    return apiErrorResponse(error, "Failed to update campaign");
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const workspaceId =
      req.nextUrl.searchParams.get("workspace")?.trim().toLowerCase() ?? "";
    if (!workspaceId) {
      return NextResponse.json(
        { error: "Missing workspace parameter" },
        { status: 400 }
      );
    }

    await requireWorkspaceAuth(req, workspaceId);
    await deleteCampaignWorkflow(workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Failed to delete campaign");
  }
}
