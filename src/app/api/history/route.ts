import { NextRequest, NextResponse } from "next/server";
import { getSendHistory, userCanAccessWorkspace } from "@/lib/db";
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

    const rows = await getSendHistory(workspace);
    const history = rows.map((row) => ({
      messageId: row.message_id,
      recipient: row.recipient,
      subject: row.subject,
      sentAt: row.sent_at,
      events: JSON.parse(row.events),
    }));

    return NextResponse.json(history);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
