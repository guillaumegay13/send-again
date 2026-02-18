import { NextRequest, NextResponse } from "next/server";
import {
  deleteAllContacts,
  getContacts,
  getWorkspaceSettings,
  upsertContacts,
  userCanAccessWorkspace,
} from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { syncContactsFromSource } from "@/lib/contact-sources";

interface SyncBody {
  workspace: string;
  replaceExisting?: boolean;
  allowEmpty?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = (await req.json()) as SyncBody;

    const workspace = String(body.workspace ?? "").trim().toLowerCase();
    if (!workspace) {
      return NextResponse.json({ error: "workspace required" }, { status: 400 });
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const settings = await getWorkspaceSettings(workspace);
    const provider = settings?.contact_source_provider ?? "manual";
    const config = settings?.contact_source_config ?? {};

    if (provider === "manual") {
      return NextResponse.json(
        {
          error:
            "This workspace uses manual contacts. Configure an integration in Settings first.",
        },
        { status: 400 }
      );
    }

    const contacts = await syncContactsFromSource({
      workspaceId: workspace,
      provider,
      config,
    });

    const replaceExisting = body.replaceExisting !== false;
    const allowEmpty = body.allowEmpty === true;

    if (contacts.length === 0 && replaceExisting && !allowEmpty) {
      return NextResponse.json(
        {
          error:
            "Sync returned zero contacts. Refusing to replace local contacts. Set allowEmpty=true to force clear.",
        },
        { status: 422 }
      );
    }

    if (replaceExisting) {
      await deleteAllContacts(workspace);
    }

    await upsertContacts(workspace, contacts);
    const allContacts = await getContacts(workspace);

    return NextResponse.json({
      ok: true,
      workspace,
      provider,
      synced: contacts.length,
      total: allContacts.length,
      contacts: allContacts,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
