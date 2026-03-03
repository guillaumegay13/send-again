import { NextRequest, NextResponse } from "next/server";
import { createApiKey, getApiKeysForWorkspace, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import {
  allApiKeyScopes,
  normalizeApiKeyScopes,
} from "@/lib/api-key-scopes";

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = await req.json();
    const { workspace, name, scopes } = body;
    if (!workspace) {
      return NextResponse.json({ error: "workspace required" }, { status: 400 });
    }
    if (scopes !== undefined && !Array.isArray(scopes)) {
      return NextResponse.json(
        { error: "scopes must be an array of strings" },
        { status: 400 }
      );
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspace);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    let normalizedScopes = allApiKeyScopes();
    if (scopes !== undefined) {
      const parsed = normalizeApiKeyScopes(scopes);
      if (parsed.invalid.length > 0) {
        return NextResponse.json(
          { error: `Invalid API key scopes: ${parsed.invalid.join(", ")}` },
          { status: 400 }
        );
      }
      if (parsed.scopes.length === 0) {
        return NextResponse.json(
          { error: "At least one API key scope is required" },
          { status: 400 }
        );
      }
      normalizedScopes = parsed.scopes;
    }

    const result = await createApiKey(workspace, name ?? "", normalizedScopes);
    return NextResponse.json({
      key: result.key,
      id: result.apiKey.id,
      name: result.apiKey.name,
      keyPrefix: result.apiKey.keyPrefix,
      scopes: result.apiKey.scopes,
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
