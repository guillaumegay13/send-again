import { getDb } from "@/lib/db";

export type ScheduledTaskKind =
  | "send_job_dispatch"
  | "campaign_step"
  | "campaign_wait";

export type ScheduledTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ScheduledTask {
  id: string;
  kind: ScheduledTaskKind;
  workspaceId: string;
  status: ScheduledTaskStatus;
  dueAt: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lockedAt: string | null;
  updatedAt: string;
}

interface ScheduledTaskRowRaw {
  id: unknown;
  kind: unknown;
  workspace_id: unknown;
  status: unknown;
  due_at: unknown;
  payload: unknown;
  attempts: unknown;
  max_attempts: unknown;
  idempotency_key: unknown;
  error_message: unknown;
  created_at: unknown;
  started_at: unknown;
  completed_at: unknown;
  locked_at: unknown;
  updated_at: unknown;
}

function assertNoError(
  error: { message: string } | null,
  context: string
): void {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function getMissingRelation(error: { message: string } | null): string | null {
  if (!error) return null;

  const relationMatch = error.message.match(
    /relation ["']?(?:public\.)?([a-z_]+)["']? does not exist/i
  );
  if (relationMatch?.[1]) return relationMatch[1];

  const schemaCacheMatch = error.message.match(
    /table ['"]public\.([a-z_]+)['"] in the schema cache/i
  );
  return schemaCacheMatch?.[1] ?? null;
}

function assertTaskTable(error: { message: string } | null): void {
  const missingRelation = getMissingRelation(error);
  if (missingRelation === "scheduled_tasks") {
    throw new Error(
      "Database schema missing `scheduled_tasks` table. Run the latest supabase/schema.sql."
    );
  }
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

function normalizePayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function normalizeTaskKind(value: unknown): ScheduledTaskKind {
  if (value === "send_job_dispatch") return "send_job_dispatch";
  if (value === "campaign_wait") return "campaign_wait";
  return "campaign_step";
}

function normalizeTaskStatus(value: unknown): ScheduledTaskStatus {
  if (value === "running") return "running";
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  return "queued";
}

function normalizeTaskRow(row: ScheduledTaskRowRaw): ScheduledTask {
  return {
    id: String(row.id ?? ""),
    kind: normalizeTaskKind(row.kind),
    workspaceId: String(row.workspace_id ?? "").trim().toLowerCase(),
    status: normalizeTaskStatus(row.status),
    dueAt: String(row.due_at ?? ""),
    payload: normalizePayload(row.payload),
    attempts: normalizeNonNegativeInteger(row.attempts, 0),
    maxAttempts: normalizePositiveInteger(row.max_attempts, 5),
    idempotencyKey: row.idempotency_key
      ? String(row.idempotency_key ?? "")
      : null,
    errorMessage: row.error_message ? String(row.error_message ?? "") : null,
    createdAt: String(row.created_at ?? ""),
    startedAt: row.started_at ? String(row.started_at ?? "") : null,
    completedAt: row.completed_at ? String(row.completed_at ?? "") : null,
    lockedAt: row.locked_at ? String(row.locked_at ?? "") : null,
    updatedAt: String(row.updated_at ?? ""),
  };
}

const SCHEDULED_TASK_SELECT =
  "id, kind, workspace_id, status, due_at, payload, attempts, max_attempts, idempotency_key, error_message, created_at, started_at, completed_at, locked_at, updated_at";

export async function enqueueScheduledTask(params: {
  kind: ScheduledTaskKind;
  workspaceId: string;
  dueAt?: string | null;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
  maxAttempts?: number;
}): Promise<ScheduledTask> {
  const db = getDb();
  const workspaceId = params.workspaceId.trim().toLowerCase();
  const dueAt = params.dueAt?.trim() || new Date().toISOString();
  const idempotencyKey = params.idempotencyKey?.trim() || null;

  if (idempotencyKey) {
    const { data: existingData, error: existingError } = await db
      .from("scheduled_tasks")
      .select(SCHEDULED_TASK_SELECT)
      .eq("idempotency_key", idempotencyKey)
      .limit(1);
    assertTaskTable(existingError);
    assertNoError(existingError, "Failed to read scheduled task");
    const existingRow = (existingData ?? [])[0] as ScheduledTaskRowRaw | undefined;
    if (existingRow) {
      return normalizeTaskRow(existingRow);
    }
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("scheduled_tasks")
    .insert({
      id: crypto.randomUUID(),
      kind: params.kind,
      workspace_id: workspaceId,
      status: "queued",
      due_at: dueAt,
      payload: params.payload,
      attempts: 0,
      max_attempts: normalizePositiveInteger(params.maxAttempts, 5),
      idempotency_key: idempotencyKey,
      created_at: now,
      updated_at: now,
    })
    .select(SCHEDULED_TASK_SELECT)
    .limit(1);
  assertTaskTable(error);
  assertNoError(error, "Failed to create scheduled task");
  const row = (data ?? [])[0] as ScheduledTaskRowRaw | undefined;
  if (!row) {
    throw new Error("Failed to read scheduled task");
  }
  return normalizeTaskRow(row);
}

function sortCandidates(left: ScheduledTask, right: ScheduledTask): number {
  const leftTime = Date.parse(
    left.status === "running" ? left.lockedAt ?? left.dueAt : left.dueAt
  );
  const rightTime = Date.parse(
    right.status === "running" ? right.lockedAt ?? right.dueAt : right.dueAt
  );

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.createdAt.localeCompare(right.createdAt);
}

export async function listScheduledTaskCandidates(params: {
  dueBeforeIso: string;
  staleBeforeIso: string;
  limit: number;
  kinds?: ScheduledTaskKind[];
}): Promise<ScheduledTask[]> {
  const db = getDb();
  const boundedLimit = Math.max(1, Math.floor(params.limit));

  let queuedQuery = db
    .from("scheduled_tasks")
    .select(SCHEDULED_TASK_SELECT)
    .eq("status", "queued")
    .lte("due_at", params.dueBeforeIso)
    .order("due_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(boundedLimit);

  let runningQuery = db
    .from("scheduled_tasks")
    .select(SCHEDULED_TASK_SELECT)
    .eq("status", "running")
    .lt("locked_at", params.staleBeforeIso)
    .order("locked_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(boundedLimit);

  if (params.kinds && params.kinds.length > 0) {
    queuedQuery = queuedQuery.in("kind", params.kinds);
    runningQuery = runningQuery.in("kind", params.kinds);
  }

  const [{ data: queuedRows, error: queuedError }, { data: runningRows, error: runningError }] =
    await Promise.all([queuedQuery, runningQuery]);

  assertTaskTable(queuedError);
  assertTaskTable(runningError);
  assertNoError(queuedError, "Failed to list due scheduled tasks");
  assertNoError(runningError, "Failed to list stale scheduled tasks");

  return [
    ...((queuedRows ?? []) as ScheduledTaskRowRaw[]).map(normalizeTaskRow),
    ...((runningRows ?? []) as ScheduledTaskRowRaw[]).map(normalizeTaskRow),
  ]
    .sort(sortCandidates)
    .slice(0, boundedLimit);
}

export async function claimQueuedScheduledTask(
  taskId: string,
  attempts: number
): Promise<ScheduledTask | null> {
  const db = getDb();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("scheduled_tasks")
    .update({
      status: "running",
      attempts: attempts + 1,
      started_at: now,
      locked_at: now,
      updated_at: now,
      error_message: null,
      completed_at: null,
    })
    .eq("id", taskId)
    .eq("status", "queued")
    .eq("attempts", attempts)
    .select(SCHEDULED_TASK_SELECT)
    .limit(1);
  assertTaskTable(error);
  assertNoError(error, "Failed to claim scheduled task");
  const row = (data ?? [])[0] as ScheduledTaskRowRaw | undefined;
  return row ? normalizeTaskRow(row) : null;
}

export async function claimStaleRunningScheduledTask(params: {
  taskId: string;
  attempts: number;
  lockedAt: string | null;
}): Promise<ScheduledTask | null> {
  const db = getDb();
  const now = new Date().toISOString();
  let query = db
    .from("scheduled_tasks")
    .update({
      attempts: params.attempts + 1,
      locked_at: now,
      updated_at: now,
      error_message: null,
    })
    .eq("id", params.taskId)
    .eq("status", "running")
    .eq("attempts", params.attempts)
    .select(SCHEDULED_TASK_SELECT)
    .limit(1);

  query = params.lockedAt
    ? query.eq("locked_at", params.lockedAt)
    : query.is("locked_at", null);

  const { data, error } = await query;
  assertTaskTable(error);
  assertNoError(error, "Failed to reclaim scheduled task");
  const row = (data ?? [])[0] as ScheduledTaskRowRaw | undefined;
  return row ? normalizeTaskRow(row) : null;
}

export async function completeScheduledTask(taskId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from("scheduled_tasks")
    .update({
      status: "completed",
      error_message: null,
      completed_at: now,
      locked_at: null,
      updated_at: now,
    })
    .eq("id", taskId);
  assertTaskTable(error);
  assertNoError(error, "Failed to complete scheduled task");
}

export async function rescheduleScheduledTask(params: {
  taskId: string;
  dueAt: string;
  errorMessage?: string | null;
}): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from("scheduled_tasks")
    .update({
      status: "queued",
      due_at: params.dueAt,
      completed_at: null,
      locked_at: null,
      updated_at: now,
      error_message:
        typeof params.errorMessage === "string"
          ? params.errorMessage.slice(0, 2000)
          : params.errorMessage === null
          ? null
          : undefined,
    })
    .eq("id", params.taskId);
  assertTaskTable(error);
  assertNoError(error, "Failed to reschedule scheduled task");
}

export async function failScheduledTask(
  taskId: string,
  errorMessage: string
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from("scheduled_tasks")
    .update({
      status: "failed",
      error_message: errorMessage.slice(0, 2000),
      completed_at: now,
      locked_at: null,
      updated_at: now,
    })
    .eq("id", taskId);
  assertTaskTable(error);
  assertNoError(error, "Failed to fail scheduled task");
}
