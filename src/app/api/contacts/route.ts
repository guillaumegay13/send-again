import { NextRequest, NextResponse } from "next/server";
import {
  filterContactsAgainstUnsubscribes,
  getContacts,
  upsertContacts,
  deleteAllContacts,
} from "@/lib/db";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const workspaceParam = req.nextUrl.searchParams.get("workspace");
    const { workspace } = await requireWorkspaceAuth(req, workspaceParam);

    return NextResponse.json(await getContacts(workspace));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workspace: workspaceParam, contacts, returnContacts } = body as {
      workspace?: string;
      contacts?: unknown;
      returnContacts?: boolean;
    };
    if (!Array.isArray(contacts)) {
      return NextResponse.json(
        { error: "contacts[] required" },
        { status: 400 }
      );
    }

    const { workspace } = await requireWorkspaceAuth(req, workspaceParam);
    const contactList = contacts as Array<{
      email: string;
      fields: Record<string, string>;
    }>;

    const filtered = await filterContactsAgainstUnsubscribes(workspace, contactList);
    await upsertContacts(workspace, filtered.contacts);

    if (returnContacts === false) {
      return NextResponse.json({
        ok: true,
        imported: filtered.contacts.length,
        skippedUnsubscribed: filtered.skipped,
      });
    }

    return NextResponse.json(await getContacts(workspace));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const workspaceParam = req.nextUrl.searchParams.get("workspace");
    const { workspace } = await requireWorkspaceAuth(req, workspaceParam);

    await deleteAllContacts(workspace);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
