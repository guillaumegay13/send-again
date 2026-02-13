import { NextRequest, NextResponse } from "next/server";
import { updateContact, deleteContact } from "@/lib/db";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const { email } = await params;
  const body = await req.json();
  const { workspace, fields } = body;
  if (!workspace) {
    return NextResponse.json({ error: "workspace required" }, { status: 400 });
  }
  const decoded = decodeURIComponent(email);
  updateContact(workspace, decoded, fields ?? {});
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const { email } = await params;
  const workspace = req.nextUrl.searchParams.get("workspace");
  if (!workspace) {
    return NextResponse.json({ error: "workspace required" }, { status: 400 });
  }
  const decoded = decodeURIComponent(email);
  deleteContact(workspace, decoded);
  return NextResponse.json({ ok: true });
}
