import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";
import { matchRecipientsByConditions } from "@/lib/campaign-runtime";
import { normalizeConditions, normalizeMatchMode } from "@/lib/campaign-workflows";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      workspace?: unknown;
      matchMode?: unknown;
      conditions?: unknown;
    };

    const { workspace } = await requireWorkspaceAuth(
      req,
      typeof body.workspace === "string" ? body.workspace : undefined,
      "contacts.read"
    );

    const conditions = normalizeConditions(body.conditions);
    if (conditions.length === 0) {
      return NextResponse.json({ matched: [] });
    }

    const matched = await matchRecipientsByConditions(
      workspace,
      normalizeMatchMode(body.matchMode),
      conditions
    );

    return NextResponse.json({ matched });
  } catch (error) {
    return apiErrorResponse(error, "Failed to match recipients");
  }
}
