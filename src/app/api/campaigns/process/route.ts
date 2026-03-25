import { NextRequest, NextResponse } from "next/server";
import { processSendJobs } from "@/lib/send-job-processor";
import { processCampaignRuns } from "@/lib/campaign-runtime";
import { isProcessorAuthorized } from "@/lib/processor-auth";

export const dynamic = "force-dynamic";

async function handleProcess(req: NextRequest) {
  if (!isProcessorAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const campaignSummary = await processCampaignRuns();
    const sendSummary = await processSendJobs();

    return NextResponse.json({
      ok: true,
      campaignSummary,
      sendSummary,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "Failed to process campaigns" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleProcess(req);
}

export async function POST(req: NextRequest) {
  return handleProcess(req);
}
