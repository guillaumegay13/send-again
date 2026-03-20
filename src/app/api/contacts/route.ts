import { NextRequest, NextResponse } from "next/server";
import {
  filterContactsAgainstUnsubscribes,
  getContacts,
  upsertContacts,
  deleteAllContacts,
  deleteContact,
} from "@/lib/db";
import { apiErrorResponse, requireWorkspaceAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const workspaceParam = req.nextUrl.searchParams.get("workspace");
    const { workspace } = await requireWorkspaceAuth(
      req,
      workspaceParam,
      "contacts.read"
    );

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

    const { workspace } = await requireWorkspaceAuth(
      req,
      workspaceParam,
      "contacts.write"
    );
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
    const email = req.nextUrl.searchParams.get("email");

    const body = await req.text();
    const parsed = body ? JSON.parse(body) : {};
    const emails = parsed.emails as string[] | undefined;

    const { workspace } = await requireWorkspaceAuth(
      req,
      workspaceParam ?? parsed.workspace,
      "contacts.write"
    );

    if (emails && Array.isArray(emails)) {
      await Promise.all(emails.map((e) => deleteContact(workspace, e)));
      return NextResponse.json({ ok: true, deleted: emails.length });
    } else if (email) {
      await deleteContact(workspace, email);
    } else {
      await deleteAllContacts(workspace);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
