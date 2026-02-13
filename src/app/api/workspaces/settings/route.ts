import { NextRequest, NextResponse } from "next/server";
import { upsertWorkspaceSettings } from "@/lib/db";

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, from, configSet, rateLimit } = body;
  if (!id || !from) {
    return NextResponse.json(
      { error: "id and from required" },
      { status: 400 }
    );
  }
  upsertWorkspaceSettings({
    id,
    from,
    configSet: configSet ?? "email-tracking-config-set",
    rateLimit: rateLimit ?? 300,
  });
  return NextResponse.json({ ok: true });
}
