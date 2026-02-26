import { NextRequest, NextResponse } from "next/server";
import { getTopicDeliveryAnalytics, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const workspace = req.nextUrl.searchParams.get("workspace");
    if (!workspace) {
      return NextResponse.json(
        { error: "Missing workspace parameter" },
        { status: 400 }
      );
    }

    const topic = req.nextUrl.searchParams.get("topic") ?? "";
    if (!topic.trim()) {
      return NextResponse.json(
        { error: "Missing topic parameter" },
        { status: 400 }
      );
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const analytics = await getTopicDeliveryAnalytics(workspace, topic);
    return NextResponse.json(analytics);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
