import { NextRequest, NextResponse } from "next/server";
import { deleteApiKey, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuthenticatedUser(req);
    const { id } = await params;
    const workspace = req.nextUrl.searchParams.get("workspace");
    if (!workspace) {
      return NextResponse.json({ error: "workspace required" }, { status: 400 });
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const deleted = await deleteApiKey(id, workspace);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
