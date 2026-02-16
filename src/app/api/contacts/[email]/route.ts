import { NextRequest, NextResponse } from "next/server";
import { updateContact, deleteContact, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const user = await requireAuthenticatedUser(req);
    const { email } = await params;
    const body = await req.json();
    const { workspace, fields } = body;
    if (!workspace) {
      return NextResponse.json({ error: "workspace required" }, { status: 400 });
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const decoded = decodeURIComponent(email);
    await updateContact(workspace, decoded, fields ?? {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const user = await requireAuthenticatedUser(req);
    const { email } = await params;
    const workspace = req.nextUrl.searchParams.get("workspace");
    if (!workspace) {
      return NextResponse.json({ error: "workspace required" }, { status: 400 });
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const decoded = decodeURIComponent(email);
    await deleteContact(workspace, decoded);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
