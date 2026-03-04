import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getCreditPacks } from "@/lib/billing";
import { userCanAccessWorkspace } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const workspace = (req.nextUrl.searchParams.get("workspace") ?? "")
      .trim()
      .toLowerCase();
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

    const packs = getCreditPacks().map((pack) => ({
      id: pack.id,
      name: pack.name,
      credits: pack.credits,
      amountCents: pack.amountCents,
      currency: pack.currency,
    }));

    return NextResponse.json({ packs });
  } catch (error) {
    return apiErrorResponse(error, "Failed to list billing credit packs");
  }
}
