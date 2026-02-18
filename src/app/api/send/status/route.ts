import { NextRequest, NextResponse } from "next/server";
import { getSendJobForUser } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const progress = await getSendJobForUser(jobId, user.id);
    if (!progress) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const completed = progress.sent + progress.failed;
    const percent = progress.total > 0 ? Math.min(100, (completed / progress.total) * 100) : 0;

    return NextResponse.json({
      ...progress,
      percent,
      isDone: progress.status === "completed" || progress.status === "failed" || progress.status === "cancelled",
    });
  } catch (error) {
    return apiErrorResponse(error, "Failed to read send job status");
  }
}
