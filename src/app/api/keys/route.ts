import { NextRequest, NextResponse } from "next/server";
import { createApiKey, getApiKeysForWorkspace, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = await req.json();
    const { workspace, name } = body;
    if (!workspace) {
      return NextResponse.json({ error: "workspace required" }, { status: 400 });
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const result = await createApiKey(workspace, name ?? "");
    return NextResponse.json({
      key: result.key,
      id: result.apiKey.id,
      name: result.apiKey.name,
      keyPrefix: result.apiKey.keyPrefix,
      createdAt: result.apiKey.createdAt,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const workspace = req.nextUrl.searchParams.get("workspace");
    if (!workspace) {
      return NextResponse.json({ error: "workspace required" }, { status: 400 });
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const keys = await getApiKeysForWorkspace(workspace);
    return NextResponse.json(keys);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
