import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";
import { getReusableSendTemplate } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const workspace = req.nextUrl.searchParams.get("workspace")?.trim().toLowerCase() ?? "";
    const messageId = req.nextUrl.searchParams.get("messageId")?.trim() ?? "";

    if (!workspace) {
      return NextResponse.json(
        { error: "Missing workspace parameter" },
        { status: 400 }
      );
    }

    if (!messageId) {
      return NextResponse.json(
        { error: "Missing messageId parameter" },
        { status: 400 }
      );
    }

    await requireWorkspaceAuth(req, workspace, "send.read");

    const template = await getReusableSendTemplate(workspace, messageId);
    if (!template) {
      return NextResponse.json(
        { error: "No reusable template found for this message" },
        { status: 404 }
      );
    }

    return NextResponse.json(template);
  } catch (error) {
    return apiErrorResponse(error, "Failed to load reusable template");
  }
}
