import { NextRequest, NextResponse } from "next/server";
import { processSendJobs } from "@/lib/send-job-processor";
import { processCampaignRuns } from "@/lib/campaign-runtime";
import {
  isProcessorAuthorized,
  isVercelCronAuthorized,
} from "@/lib/processor-auth";

export const dynamic = "force-dynamic";

async function handleProcess() {
  let campaignSummary: Awaited<ReturnType<typeof processCampaignRuns>> | null = null;
  let campaignError: string | null = null;
  let sendSummary: Awaited<ReturnType<typeof processSendJobs>> | null = null;
  let sendError: string | null = null;

  try {
    campaignSummary = await processCampaignRuns();
  } catch (error) {
    campaignError = error instanceof Error ? error.message : String(error);
    console.error("Campaign processor failed:", error);
  }

  try {
    sendSummary = await processSendJobs();
  } catch (error) {
    sendError = error instanceof Error ? error.message : String(error);
    console.error("Send job processor failed:", error);
  }

  const ok = !campaignError && !sendError;
  return NextResponse.json(
    {
      ok,
      campaignSummary,
      campaignError,
      sendSummary,
      sendError,
    },
    { status: ok ? 200 : 500 }
  );
}

export async function GET(req: NextRequest) {
  if (!isVercelCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return handleProcess();
}

export async function POST(req: NextRequest) {
  if (!isProcessorAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return handleProcess();
}
