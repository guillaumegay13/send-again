import {
  processScheduledTasks,
  type ScheduledTaskProcessSummary,
} from "@/lib/task-processor";
import {
  processSendJobs,
  type SendJobProcessSummary,
} from "@/lib/send-job-processor";

export interface BackgroundProcessSummary {
  ok: boolean;
  taskSummary: ScheduledTaskProcessSummary | null;
  taskError: string | null;
  sendSummary: SendJobProcessSummary | null;
  sendError: string | null;
}

export async function processBackgroundWork(): Promise<BackgroundProcessSummary> {
  let taskSummary: ScheduledTaskProcessSummary | null = null;
  let taskError: string | null = null;
  let sendSummary: SendJobProcessSummary | null = null;
  let sendError: string | null = null;

  try {
    taskSummary = await processScheduledTasks();
  } catch (error) {
    taskError = error instanceof Error ? error.message : String(error);
    console.error("Scheduled task processor failed:", error);
  }

  try {
    sendSummary = await processSendJobs();
  } catch (error) {
    sendError = error instanceof Error ? error.message : String(error);
    console.error("Send job processor failed:", error);
  }

  return {
    ok: !taskError && !sendError,
    taskSummary,
    taskError,
    sendSummary,
    sendError,
  };
}

export function didBackgroundWork(summary: BackgroundProcessSummary): boolean {
  return (
    (summary.taskSummary?.tasksClaimed ?? 0) > 0 ||
    (summary.taskSummary?.tasksRequeued ?? 0) > 0 ||
    (summary.sendSummary?.jobsClaimed ?? 0) > 0 ||
    (summary.sendSummary?.recipientsProcessed ?? 0) > 0
  );
}

export async function drainBackgroundWork(
  maxIterations: number
): Promise<BackgroundProcessSummary> {
  let summary: BackgroundProcessSummary = {
    ok: true,
    taskSummary: null,
    taskError: null,
    sendSummary: null,
    sendError: null,
  };

  const boundedIterations = Math.max(1, Math.floor(maxIterations));
  for (let index = 0; index < boundedIterations; index += 1) {
    summary = await processBackgroundWork();
    if (!didBackgroundWork(summary)) {
      break;
    }
  }

  return summary;
}
