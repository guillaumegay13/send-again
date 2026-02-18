import { NextRequest, NextResponse } from "next/server";
import { processSendJobs } from "@/lib/send-job-processor";

function isAuthorized(req: NextRequest): boolean {
  const token = process.env.SEND_JOB_PROCESSOR_TOKEN;
  if (!token) return true;

  const header = req.headers.get("x-send-job-token");
  const authHeader = req.headers.get("authorization");

  const provided =
    header?.trim() ??
    authHeader?.replace(/^Bearer\s+/i, "")?.trim() ??
    null;

  return provided === token;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await processSendJobs();
    const errors = summary.errors.slice(0, 20);

    return NextResponse.json({
      ok: true,
      jobsClaimed: summary.jobsClaimed,
      jobsCompleted: summary.jobsCompleted,
      recipientsProcessed: summary.recipientsProcessed,
      errors,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ ok: false, error: "Failed to process send jobs" }, { status: 500 });
  }
}
