import { activateScheduledSendJob } from "@/lib/db";
import {
  handleCampaignStepTask,
  handleCampaignWaitTask,
} from "@/lib/campaign-runtime";
import {
  claimQueuedScheduledTask,
  claimStaleRunningScheduledTask,
  completeScheduledTask,
  failScheduledTask,
  listScheduledTaskCandidates,
  rescheduleScheduledTask,
  type ScheduledTask,
  type ScheduledTaskKind,
} from "@/lib/task-queue";

interface ProcessScheduledTasksOptions {
  maxTasks?: number;
  staleMs?: number;
  kinds?: ScheduledTaskKind[];
}

interface ScheduledTaskHandlerResult {
  requeueAt?: string | null;
}

export interface ScheduledTaskProcessSummary {
  tasksClaimed: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksRequeued: number;
  sendJobsDispatched: number;
  campaignStepsProcessed: number;
  campaignWaitsProcessed: number;
  errors: string[];
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.floor(parsed));
}

function trimMessage(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : value instanceof Error
      ? value.message
      : "Scheduled task failed";
  return text.replace(/\s+/g, " ").trim().slice(0, 1000);
}

async function runScheduledTask(
  task: ScheduledTask
): Promise<ScheduledTaskHandlerResult> {
  if (task.kind === "send_job_dispatch") {
    const sendJobId = String(task.payload.sendJobId ?? "").trim();
    if (!sendJobId) {
      throw new Error("Scheduled send task missing sendJobId");
    }
    await activateScheduledSendJob(sendJobId);
    return {};
  }

  if (task.kind === "campaign_wait") {
    const stepId = String(task.payload.stepId ?? "").trim();
    if (!stepId) {
      throw new Error("Campaign wait task missing stepId");
    }
    return handleCampaignWaitTask(stepId);
  }

  const stepId = String(task.payload.stepId ?? "").trim();
  if (!stepId) {
    throw new Error("Campaign step task missing stepId");
  }
  return handleCampaignStepTask(stepId);
}

export async function processScheduledTasks(
  options: ProcessScheduledTasksOptions = {}
): Promise<ScheduledTaskProcessSummary> {
  const summary: ScheduledTaskProcessSummary = {
    tasksClaimed: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    tasksRequeued: 0,
    sendJobsDispatched: 0,
    campaignStepsProcessed: 0,
    campaignWaitsProcessed: 0,
    errors: [],
  };

  const staleMs = normalizeNonNegativeInteger(
    options.staleMs,
    normalizeNonNegativeInteger(process.env.SCHEDULED_TASK_STALE_MS, 180000)
  );
  const candidates = await listScheduledTaskCandidates({
    dueBeforeIso: new Date().toISOString(),
    staleBeforeIso: new Date(Date.now() - staleMs).toISOString(),
    limit: normalizePositiveInteger(
      options.maxTasks,
      normalizePositiveInteger(process.env.SCHEDULED_TASK_BATCH_SIZE, 25)
    ),
    kinds: options.kinds,
  });

  for (const candidate of candidates) {
    const claimed =
      candidate.status === "queued"
        ? await claimQueuedScheduledTask(candidate.id, candidate.attempts)
        : await claimStaleRunningScheduledTask({
            taskId: candidate.id,
            attempts: candidate.attempts,
            lockedAt: candidate.lockedAt,
          });

    if (!claimed) {
      continue;
    }

    summary.tasksClaimed += 1;

    try {
      const result = await runScheduledTask(claimed);
      if (claimed.kind === "send_job_dispatch") {
        summary.sendJobsDispatched += 1;
      } else if (claimed.kind === "campaign_wait") {
        summary.campaignWaitsProcessed += 1;
      } else {
        summary.campaignStepsProcessed += 1;
      }

      if (result.requeueAt) {
        await rescheduleScheduledTask({
          taskId: claimed.id,
          dueAt: result.requeueAt,
          errorMessage: null,
        });
        summary.tasksRequeued += 1;
      } else {
        await completeScheduledTask(claimed.id);
        summary.tasksCompleted += 1;
      }
    } catch (error) {
      const message = trimMessage(error);
      summary.errors.push(message);
      if (claimed.attempts >= claimed.maxAttempts) {
        await failScheduledTask(claimed.id, message).catch(() => {
          // no-op
        });
        summary.tasksFailed += 1;
      } else {
        await rescheduleScheduledTask({
          taskId: claimed.id,
          dueAt: new Date().toISOString(),
          errorMessage: message,
        }).catch(() => {
          // no-op
        });
        summary.tasksRequeued += 1;
      }
    }
  }

  return summary;
}
