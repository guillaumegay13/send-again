import { NextRequest, NextResponse } from "next/server";
import { getContactsByEmails, updateContact, deleteContact } from "@/lib/db";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const { email } = await params;
    const workspaceParam = req.nextUrl.searchParams.get("workspace");
    const { workspace } = await requireWorkspaceAuth(req, workspaceParam);

    const decoded = decodeURIComponent(email);
    const contacts = await getContactsByEmails(workspace, [decoded]);
    if (contacts.length === 0) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    return NextResponse.json(contacts[0]);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  try {
    const { email } = await params;
    const body = await req.json();
    const { workspace: workspaceParam, fields } = body;
    const { workspace } = await requireWorkspaceAuth(req, workspaceParam);

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
    const { email } = await params;
    const workspaceParam = req.nextUrl.searchParams.get("workspace");
    const { workspace } = await requireWorkspaceAuth(req, workspaceParam);

    const decoded = decodeURIComponent(email);
    await deleteContact(workspace, decoded);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
