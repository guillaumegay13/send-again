import { NextRequest, NextResponse } from "next/server";
import { getSendJobForUser, getSendJobForWorkspace } from "@/lib/db";
import { processSendJobs } from "@/lib/send-job-processor";
import {
  apiErrorResponse,
  requireAuthenticatedUser,
  requireWorkspaceAuth,
} from "@/lib/auth";

function normalizePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function envFlagEnabled(value: string | undefined, fallback = true): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return !["0", "false", "off", "no"].includes(normalized);
}

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const isApiKeyAuth =
      authHeader.startsWith("Bearer ") &&
      authHeader.slice("Bearer ".length).trim().startsWith("sk_");
    const apiKeyWorkspace = isApiKeyAuth
      ? (await requireWorkspaceAuth(req, undefined, "send.read")).workspace
      : null;
    const jwtUserId = isApiKeyAuth ? null : (await requireAuthenticatedUser(req)).id;

    let progress = null;
    if (apiKeyWorkspace) {
      progress = await getSendJobForWorkspace(jobId, apiKeyWorkspace);
    } else if (jwtUserId) {
      progress = await getSendJobForUser(jobId, jwtUserId);
    }

    if (!progress) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const isActiveJob =
      progress.status === "queued" || progress.status === "running";
    if (
      isActiveJob &&
      envFlagEnabled(process.env.SEND_JOB_STATUS_INLINE_PROCESS, true)
    ) {
      try {
        await processSendJobs({
          maxJobs: normalizePositiveInteger(
            process.env.SEND_JOB_STATUS_INLINE_MAX_JOBS,
            3
          ),
          maxRecipientsPerJob: normalizePositiveInteger(
            process.env.SEND_JOB_STATUS_INLINE_MAX_RECIPIENTS,
            50
          ),
        });
      } catch (error) {
        console.error("Inline send processing from status route failed:", error);
      }

      if (apiKeyWorkspace) {
        const refreshed = await getSendJobForWorkspace(jobId, apiKeyWorkspace);
        if (refreshed) {
          progress = refreshed;
        }
      } else if (jwtUserId) {
        const refreshed = await getSendJobForUser(jobId, jwtUserId);
        if (refreshed) {
          progress = refreshed;
        }
      }
    }

    const completed = progress.sent + progress.failed;
    const percent =
      progress.total > 0 ? Math.min(100, (completed / progress.total) * 100) : 0;

    return NextResponse.json({
      ...progress,
      percent,
      isDone:
        progress.status === "completed" ||
        progress.status === "failed" ||
        progress.status === "cancelled",
    });
  } catch (error) {
    return apiErrorResponse(error, "Failed to read send job status");
  }
}
