import { NextRequest, NextResponse } from "next/server";
import { getSendHistory } from "@/lib/db";

export async function GET(req: NextRequest) {
  const workspace = req.nextUrl.searchParams.get("workspace");
  if (!workspace) {
    return NextResponse.json(
      { error: "Missing workspace parameter" },
      { status: 400 }
    );
  }

  const rows = getSendHistory(workspace);
  const history = rows.map((row) => ({
    messageId: row.message_id,
    recipient: row.recipient,
    subject: row.subject,
    sentAt: row.sent_at,
    events: JSON.parse(row.events),
  }));

  return NextResponse.json(history);
}
