import { NextRequest, NextResponse } from "next/server";
import {
  getContacts,
  upsertContacts,
  deleteAllContacts,
} from "@/lib/db";

export async function GET(req: NextRequest) {
  const workspace = req.nextUrl.searchParams.get("workspace");
  if (!workspace) {
    return NextResponse.json({ error: "workspace required" }, { status: 400 });
  }
  return NextResponse.json(getContacts(workspace));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { workspace, contacts } = body;
  if (!workspace || !Array.isArray(contacts)) {
    return NextResponse.json(
      { error: "workspace and contacts[] required" },
      { status: 400 }
    );
  }
  upsertContacts(workspace, contacts);
  return NextResponse.json(getContacts(workspace));
}

export async function DELETE(req: NextRequest) {
  const workspace = req.nextUrl.searchParams.get("workspace");
  if (!workspace) {
    return NextResponse.json({ error: "workspace required" }, { status: 400 });
  }
  deleteAllContacts(workspace);
  return NextResponse.json({ ok: true });
}
