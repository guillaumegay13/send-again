import { NextRequest, NextResponse } from "next/server";
import { processBackgroundWork } from "@/lib/background-processors";
import {
  isProcessorAuthorized,
  isVercelCronAuthorized,
} from "@/lib/processor-auth";

async function buildProcessResponse() {
  const summary = await processBackgroundWork();

  return NextResponse.json(
    {
      ok: summary.ok,
      taskSummary: summary.taskSummary
        ? {
            ...summary.taskSummary,
            errors: summary.taskSummary.errors.slice(0, 20),
          }
        : null,
      taskError: summary.taskError,
      sendSummary: summary.sendSummary
        ? {
            ...summary.sendSummary,
            errors: summary.sendSummary.errors.slice(0, 20),
          }
        : null,
      sendError: summary.sendError,
    },
    { status: summary.ok ? 200 : 500 }
  );
}

export async function handleBackgroundProcessGet(req: NextRequest) {
  if (!isVercelCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await buildProcessResponse();
  } catch (error) {
    console.error("Background task processing failed:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to process background tasks" },
      { status: 500 }
    );
  }
}

export async function handleBackgroundProcessPost(req: NextRequest) {
  if (!isProcessorAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await buildProcessResponse();
  } catch (error) {
    console.error("Background task processing failed:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to process background tasks" },
      { status: 500 }
    );
  }
}
