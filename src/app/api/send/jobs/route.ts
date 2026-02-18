import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { getSendJobsForUser, SendJobStatus } from "@/lib/db";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.floor(parsed));
}

function parseStatuses(value: string | null): SendJobStatus[] {
  if (!value) return [];
  const raw = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const allowed = new Set<SendJobStatus>([
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]);

  const unique: SendJobStatus[] = [];
  for (const item of raw) {
    if (!allowed.has(item as SendJobStatus)) continue;
    if (!unique.includes(item as SendJobStatus)) {
      unique.push(item as SendJobStatus);
    }
  }

  return unique;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const workspaceId =
      req.nextUrl.searchParams.get("workspace")?.trim().toLowerCase() || undefined;
    const limit = parseLimit(req.nextUrl.searchParams.get("limit"));
    const statuses = parseStatuses(req.nextUrl.searchParams.get("status"));

    const jobs = await getSendJobsForUser(user.id, {
      workspaceId,
      statuses,
      limit,
    });

    return NextResponse.json({ jobs });
  } catch (error) {
    return apiErrorResponse(error, "Failed to read send jobs");
  }
}
