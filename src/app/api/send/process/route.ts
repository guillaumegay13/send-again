import { NextRequest, NextResponse } from "next/server";
import { processSendJobs } from "@/lib/send-job-processor";
import { isProcessorAuthorized } from "@/lib/processor-auth";

export const dynamic = "force-dynamic";

async function handleProcess(req: NextRequest) {
  if (!isProcessorAuthorized(req)) {
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
    return NextResponse.json(
      { ok: false, error: "Failed to process send jobs" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handleProcess(req);
}
