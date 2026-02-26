import { NextRequest, NextResponse } from "next/server";
import { getSendHistory, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

function parsePositiveInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

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

    const page = parsePositiveInt(
      req.nextUrl.searchParams.get("page"),
      1,
      1,
      100000
    );
    const pageSize = parsePositiveInt(
      req.nextUrl.searchParams.get("pageSize"),
      25,
      1,
      100
    );
    const search = req.nextUrl.searchParams.get("search") ?? "";

    const result = await getSendHistory(workspace, {
      page,
      pageSize,
      search,
    });
    const history = result.rows.map((row) => ({
      messageId: row.message_id,
      recipient: row.recipient,
      subject: row.subject,
      sentAt: row.sent_at,
      events: JSON.parse(row.events),
    }));

    return NextResponse.json({
      items: history,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.page * result.pageSize < result.total,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
