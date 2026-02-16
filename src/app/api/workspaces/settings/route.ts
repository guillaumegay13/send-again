import { NextRequest, NextResponse } from "next/server";
import { upsertWorkspaceSettings, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = await req.json();
    const { id, from, configSet, rateLimit } = body;
    if (!id || !from) {
      return NextResponse.json(
        { error: "id and from required" },
        { status: 400 }
      );
    }

    const hasAccess = await userCanAccessWorkspace(user.id, id);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    await upsertWorkspaceSettings({
      id,
      from,
      configSet: configSet ?? "email-tracking-config-set",
      rateLimit: rateLimit ?? 300,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
