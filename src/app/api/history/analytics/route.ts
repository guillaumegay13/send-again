import { NextRequest, NextResponse } from "next/server";
import {
  getCampaignPerformanceAnalytics,
  getSubjectCampaignAnalytics,
  getTopicDeliveryAnalytics,
  userCanAccessWorkspace,
} from "@/lib/db";
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

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const mode = req.nextUrl.searchParams.get("mode");
    if (mode === "subject") {
      const limitValue = Number(req.nextUrl.searchParams.get("limit") ?? "50");
      const limit = Number.isFinite(limitValue) ? limitValue : 50;
      const items = await getSubjectCampaignAnalytics(workspace, { limit });
      return NextResponse.json({ items });
    }

    if (mode === "campaign") {
      const subject = req.nextUrl.searchParams.get("subject") ?? "";
      if (!subject.trim()) {
        return NextResponse.json(
          { error: "Missing subject parameter" },
          { status: 400 }
        );
      }
      const analytics = await getCampaignPerformanceAnalytics(workspace, subject);
      return NextResponse.json(analytics);
    }

    const topic = req.nextUrl.searchParams.get("topic") ?? "";
    if (!topic.trim()) {
      return NextResponse.json(
        { error: "Missing topic parameter" },
        { status: 400 }
      );
    }

    const analytics = await getTopicDeliveryAnalytics(workspace, topic);
    return NextResponse.json(analytics);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
