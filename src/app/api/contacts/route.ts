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
    let parsed: {
      workspace?: string;
      emails?: unknown;
      confirmDeleteAll?: unknown;
    } = {};
    if (body) {
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 }
        );
      }
    }

    const emails = parsed.emails;
    const confirmDeleteAll = parsed.confirmDeleteAll === true;

    const { workspace } = await requireWorkspaceAuth(
      req,
      workspaceParam ?? parsed.workspace,
      "contacts.write"
    );

    if (Array.isArray(emails)) {
      const normalizedEmails = emails
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
      if (normalizedEmails.length !== emails.length) {
        return NextResponse.json(
          { error: "emails[] must contain only non-empty strings" },
          { status: 400 }
        );
      }

      await Promise.all(normalizedEmails.map((value) => deleteContact(workspace, value)));
      return NextResponse.json({ ok: true, deleted: normalizedEmails.length });
    }

    const normalizedEmail = email?.trim();
    if (normalizedEmail) {
      await deleteContact(workspace, normalizedEmail);
      return NextResponse.json({ ok: true });
    }

    // Fail closed: full workspace purges require an explicit confirmation flag.
    if (confirmDeleteAll) {
      await deleteAllContacts(workspace);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      {
        error:
          "Explicit delete target required. Use ?email=, body.emails[], or body.confirmDeleteAll=true.",
      },
      { status: 400 }
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
