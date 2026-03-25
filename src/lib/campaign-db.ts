import { getDb } from "@/lib/db";
import {
  normalizeCampaign,
  normalizeString,
  sanitizeCampaignDraft,
  type CampaignDraft,
  type SavedCampaign,
} from "@/lib/campaign-workflows";

export type CampaignRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type CampaignRunStepStatus =
  | "pending"
  | "waiting"
  | "processing"
  | "completed"
  | "failed";

export interface CampaignRunRow {
  id: string;
  campaignId: string;
  workspaceId: string;
  userId: string;
  status: CampaignRunStatus;
  billingBypass: boolean;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  heartbeatAt: string | null;
  updatedAt: string;
}

export interface CampaignRunStep {
  id: string;
  runId: string;
  nodeId: string;
  status: CampaignRunStepStatus;
  dueAt: string;
  blockingSendJobId: string | null;
  recipientEmails: string[];
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface CampaignRunSendJob {
  id: string;
  status: string;
  subject: string;
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface CampaignRunProgress extends CampaignRunRow {
  campaignName: string;
  stepCounts: Record<CampaignRunStepStatus, number> & { total: number };
  sendJobs: CampaignRunSendJob[];
}

interface CampaignWorkflowRow {
  id: unknown;
  workspace_id: unknown;
  name: unknown;
  definition: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface CampaignRunRowRaw {
  id: unknown;
  campaign_id: unknown;
  workspace_id: unknown;
  user_id: unknown;
  status: unknown;
  billing_bypass: unknown;
  error_message: unknown;
  created_at: unknown;
  started_at: unknown;
  completed_at: unknown;
  heartbeat_at: unknown;
  updated_at: unknown;
}

interface CampaignRunStepRowRaw {
  id: unknown;
  run_id: unknown;
  node_id: unknown;
  status: unknown;
  due_at: unknown;
  blocking_send_job_id: unknown;
  recipient_emails: unknown;
  error_message: unknown;
  created_at: unknown;
  started_at: unknown;
  completed_at: unknown;
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

function isMissingTableError(
  error: { message: string } | null,
  table: string
): boolean {
  if (!error) return false;
  const message = error.message.toLowerCase();
  if (!message.includes(table.toLowerCase())) return false;
  return message.includes("schema cache") || message.includes("does not exist");
}

function assertCampaignTable(error: { message: string } | null, table: string): void {
  const missingRelation = getMissingRelation(error);
  if (missingRelation === table || isMissingTableError(error, table)) {
    throw new Error(
      `Database schema missing \`${table}\` table. Run the latest supabase/schema.sql.`
    );
  }
}

function normalizeCampaignRunStatus(value: unknown): CampaignRunStatus {
  if (value === "running") return "running";
  if (value === "waiting") return "waiting";
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  return "queued";
}

function normalizeCampaignRunStepStatus(value: unknown): CampaignRunStepStatus {
  if (value === "waiting") return "waiting";
  if (value === "processing") return "processing";
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  return "pending";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function normalizeWorkspaceId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeWorkflowRow(row: CampaignWorkflowRow): SavedCampaign {
  const definition = normalizeCampaign(row.definition);
  if (!definition) {
    throw new Error("Stored campaign definition is invalid");
  }
  const sanitized = sanitizeCampaignDraft(definition);
  return {
    ...sanitized,
    campaignId: String(row.id ?? sanitized.campaignId),
    name: normalizeString(row.name, sanitized.name || "Campaign"),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function normalizeCampaignRunRow(row: CampaignRunRowRaw): CampaignRunRow {
  return {
    id: String(row.id ?? ""),
    campaignId: String(row.campaign_id ?? ""),
    workspaceId: String(row.workspace_id ?? ""),
    userId: String(row.user_id ?? ""),
    status: normalizeCampaignRunStatus(row.status),
    billingBypass: row.billing_bypass === true,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at ?? ""),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    heartbeatAt: row.heartbeat_at ? String(row.heartbeat_at) : null,
    updatedAt: String(row.updated_at ?? ""),
  };
}

function normalizeCampaignRunStepRow(row: CampaignRunStepRowRaw): CampaignRunStep {
  return {
    id: String(row.id ?? ""),
    runId: String(row.run_id ?? ""),
    nodeId: String(row.node_id ?? ""),
    status: normalizeCampaignRunStepStatus(row.status),
    dueAt: String(row.due_at ?? ""),
    blockingSendJobId: row.blocking_send_job_id
      ? String(row.blocking_send_job_id)
      : null,
    recipientEmails: normalizeStringArray(row.recipient_emails),
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: String(row.created_at ?? ""),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listCampaignWorkflows(
  workspaceId: string
): Promise<SavedCampaign[]> {
  const db = getDb();
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const { data, error } = await db
    .from("campaign_workflows")
    .select("id, workspace_id, name, definition, created_at, updated_at")
    .eq("workspace_id", normalizedWorkspaceId)
    .order("updated_at", { ascending: false });
  assertCampaignTable(error, "campaign_workflows");
  assertNoError(error, "Failed to list campaigns");
  return ((data ?? []) as CampaignWorkflowRow[]).map(normalizeWorkflowRow);
}

export async function getCampaignWorkflowForWorkspace(
  workspaceId: string,
  campaignId: string
): Promise<SavedCampaign | null> {
  const db = getDb();
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const { data, error } = await db
    .from("campaign_workflows")
    .select("id, workspace_id, name, definition, created_at, updated_at")
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("id", campaignId)
    .limit(1);
  assertCampaignTable(error, "campaign_workflows");
  assertNoError(error, "Failed to read campaign");
  const row = (data ?? [])[0] as CampaignWorkflowRow | undefined;
  return row ? normalizeWorkflowRow(row) : null;
}

export async function getCampaignWorkflowById(
  campaignId: string
): Promise<SavedCampaign | null> {
  const db = getDb();
  const { data, error } = await db
    .from("campaign_workflows")
    .select("id, workspace_id, name, definition, created_at, updated_at")
    .eq("id", campaignId)
    .limit(1);
  assertCampaignTable(error, "campaign_workflows");
  assertNoError(error, "Failed to read campaign");
  const row = (data ?? [])[0] as CampaignWorkflowRow | undefined;
  return row ? normalizeWorkflowRow(row) : null;
}

export async function upsertCampaignWorkflow(params: {
  workspaceId: string;
  draft: CampaignDraft;
}): Promise<SavedCampaign> {
  const db = getDb();
  const workspaceId = normalizeWorkspaceId(params.workspaceId);
  const sanitized = sanitizeCampaignDraft(params.draft);
  const now = new Date().toISOString();
  const { data: existingRows, error: existingError } = await db
    .from("campaign_workflows")
    .select("workspace_id")
    .eq("id", sanitized.campaignId)
    .limit(1);
  assertCampaignTable(existingError, "campaign_workflows");
  assertNoError(existingError, "Failed to validate campaign ownership");

  const existingWorkspaceId = String(
    (existingRows as Array<{ workspace_id: unknown }> | null)?.[0]?.workspace_id ?? ""
  )
    .trim()
    .toLowerCase();
  if (existingWorkspaceId && existingWorkspaceId !== workspaceId) {
    throw new Error("Campaign belongs to a different workspace");
  }

  const { data, error } = await db
    .from("campaign_workflows")
    .upsert(
      {
        id: sanitized.campaignId,
        workspace_id: workspaceId,
        name: sanitized.name.trim() || "Campaign",
        definition: sanitized,
        updated_at: now,
      },
      { onConflict: "id" }
    )
    .select("id, workspace_id, name, definition, created_at, updated_at")
    .limit(1);
  assertCampaignTable(error, "campaign_workflows");
  assertNoError(error, "Failed to save campaign");
  const row = (data ?? [])[0] as CampaignWorkflowRow | undefined;
  if (!row) {
    throw new Error("Failed to read saved campaign");
  }
  return normalizeWorkflowRow(row);
}

export async function deleteCampaignWorkflow(
  workspaceId: string,
  campaignId: string
): Promise<void> {
  const db = getDb();
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const { error } = await db
    .from("campaign_workflows")
    .delete()
    .eq("workspace_id", normalizedWorkspaceId)
    .eq("id", campaignId);
  assertCampaignTable(error, "campaign_workflows");
  assertNoError(error, "Failed to delete campaign");
}

export async function createCampaignRun(params: {
  campaignId: string;
  workspaceId: string;
  userId: string;
  billingBypass: boolean;
}): Promise<CampaignRunRow> {
  const db = getDb();
  const workspaceId = normalizeWorkspaceId(params.workspaceId);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("campaign_runs")
    .insert({
      id,
      campaign_id: params.campaignId,
      workspace_id: workspaceId,
      user_id: params.userId,
      status: "queued",
      billing_bypass: params.billingBypass,
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, campaign_id, workspace_id, user_id, status, billing_bypass, error_message, created_at, started_at, completed_at, heartbeat_at, updated_at"
    )
    .limit(1);
  assertCampaignTable(error, "campaign_runs");
  assertNoError(error, "Failed to create campaign run");
  const row = (data ?? [])[0] as CampaignRunRowRaw | undefined;
  if (!row) {
    throw new Error("Failed to read created campaign run");
  }
  return normalizeCampaignRunRow(row);
}

export async function getCampaignRunById(
  runId: string
): Promise<CampaignRunRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from("campaign_runs")
    .select(
      "id, campaign_id, workspace_id, user_id, status, billing_bypass, error_message, created_at, started_at, completed_at, heartbeat_at, updated_at"
    )
    .eq("id", runId)
    .limit(1);
  assertCampaignTable(error, "campaign_runs");
  assertNoError(error, "Failed to read campaign run");
  const row = (data ?? [])[0] as CampaignRunRowRaw | undefined;
  return row ? normalizeCampaignRunRow(row) : null;
}

async function buildCampaignRunProgress(
  row: CampaignRunRow
): Promise<CampaignRunProgress> {
  const db = getDb();
  const workflow = await getCampaignWorkflowById(row.campaignId);
  const { data: stepData, error: stepError } = await db
    .from("campaign_run_steps")
    .select("status")
    .eq("run_id", row.id);
  assertCampaignTable(stepError, "campaign_run_steps");
  assertNoError(stepError, "Failed to read campaign run steps");

  const counts = {
    pending: 0,
    waiting: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    total: 0,
  };
  for (const raw of (stepData ?? []) as Array<{ status: unknown }>) {
    const status = normalizeCampaignRunStepStatus(raw.status);
    counts[status] += 1;
    counts.total += 1;
  }

  const { data: sendJobData, error: sendJobError } = await db
    .from("send_jobs")
    .select(
      "id, status, total, sent, failed, payload, created_at, completed_at, error_message"
    )
    .eq("campaign_run_id", row.id)
    .order("created_at", { ascending: false });
  assertNoError(sendJobError, "Failed to read campaign run send jobs");

  const sendJobs: CampaignRunSendJob[] = (
    (sendJobData ?? []) as Array<{
      id: string;
      status: string;
      total: number;
      sent: number;
      failed: number;
      payload: unknown;
      created_at: string;
      completed_at: string | null;
      error_message: string | null;
    }>
  ).map((job) => {
    const payload =
      job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
        ? (job.payload as Record<string, unknown>)
        : {};
    return {
      id: job.id,
      status: job.status,
      subject: String(payload.subject ?? ""),
      total: Number(job.total ?? 0),
      sent: Number(job.sent ?? 0),
      failed: Number(job.failed ?? 0),
      createdAt: job.created_at,
      completedAt: job.completed_at,
      errorMessage: job.error_message ?? null,
    };
  });

  return {
    ...row,
    campaignName: workflow?.name ?? "Campaign",
    stepCounts: counts,
    sendJobs,
  };
}

export async function getCampaignRunForUser(
  runId: string,
  userId: string
): Promise<CampaignRunProgress | null> {
  const db = getDb();
  const { data, error } = await db
    .from("campaign_runs")
    .select(
      "id, campaign_id, workspace_id, user_id, status, billing_bypass, error_message, created_at, started_at, completed_at, heartbeat_at, updated_at"
    )
    .eq("id", runId)
    .eq("user_id", userId)
    .limit(1);
  assertCampaignTable(error, "campaign_runs");
  assertNoError(error, "Failed to read campaign run");
  const row = (data ?? [])[0] as CampaignRunRowRaw | undefined;
  if (!row) return null;
  return buildCampaignRunProgress(normalizeCampaignRunRow(row));
}

export async function getCampaignRunForWorkspace(
  runId: string,
  workspaceId: string
): Promise<CampaignRunProgress | null> {
  const db = getDb();
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  const { data, error } = await db
    .from("campaign_runs")
    .select(
      "id, campaign_id, workspace_id, user_id, status, billing_bypass, error_message, created_at, started_at, completed_at, heartbeat_at, updated_at"
    )
    .eq("id", runId)
    .eq("workspace_id", normalizedWorkspaceId)
    .limit(1);
  assertCampaignTable(error, "campaign_runs");
  assertNoError(error, "Failed to read campaign run");
  const row = (data ?? [])[0] as CampaignRunRowRaw | undefined;
  if (!row) return null;
  return buildCampaignRunProgress(normalizeCampaignRunRow(row));
}

export async function createCampaignRunStep(params: {
  runId: string;
  nodeId: string;
  dueAt?: string;
  status?: CampaignRunStepStatus;
  blockingSendJobId?: string | null;
  recipientEmails?: string[];
}): Promise<CampaignRunStep> {
  const db = getDb();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("campaign_run_steps")
    .insert({
      id: crypto.randomUUID(),
      run_id: params.runId,
      node_id: params.nodeId,
      status: params.status ?? "pending",
      due_at: params.dueAt ?? now,
      blocking_send_job_id: params.blockingSendJobId ?? null,
      recipient_emails: params.recipientEmails ?? [],
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, run_id, node_id, status, due_at, blocking_send_job_id, recipient_emails, error_message, created_at, started_at, completed_at, updated_at"
    )
    .limit(1);
  assertCampaignTable(error, "campaign_run_steps");
  assertNoError(error, "Failed to create campaign run step");
  const row = (data ?? [])[0] as CampaignRunStepRowRaw | undefined;
  if (!row) {
    throw new Error("Failed to read created campaign run step");
  }
  return normalizeCampaignRunStepRow(row);
}

export async function listPendingCampaignRunSteps(
  dueBeforeIso: string,
  limit = 25
): Promise<CampaignRunStep[]> {
  const db = getDb();
  const { data, error } = await db
    .from("campaign_run_steps")
    .select(
      "id, run_id, node_id, status, due_at, blocking_send_job_id, recipient_emails, error_message, created_at, started_at, completed_at, updated_at"
    )
    .eq("status", "pending")
    .lte("due_at", dueBeforeIso)
    .order("due_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.floor(limit)));
  assertCampaignTable(error, "campaign_run_steps");
  assertNoError(error, "Failed to list pending campaign steps");
  return ((data ?? []) as CampaignRunStepRowRaw[]).map(
    normalizeCampaignRunStepRow
  );
}

export async function listWaitingCampaignRunSteps(
  limit = 25
): Promise<CampaignRunStep[]> {
  const db = getDb();
  const { data, error } = await db
    .from("campaign_run_steps")
    .select(
      "id, run_id, node_id, status, due_at, blocking_send_job_id, recipient_emails, error_message, created_at, started_at, completed_at, updated_at"
    )
    .eq("status", "waiting")
    .order("updated_at", { ascending: true })
    .limit(Math.max(1, Math.floor(limit)));
  assertCampaignTable(error, "campaign_run_steps");
  assertNoError(error, "Failed to list waiting campaign steps");
  return ((data ?? []) as CampaignRunStepRowRaw[]).map(
    normalizeCampaignRunStepRow
  );
}

export async function claimCampaignRunStep(
  stepId: string
): Promise<CampaignRunStep | null> {
  const db = getDb();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("campaign_run_steps")
    .update({
      status: "processing",
      started_at: now,
      updated_at: now,
    })
    .eq("id", stepId)
    .eq("status", "pending")
    .select(
      "id, run_id, node_id, status, due_at, blocking_send_job_id, recipient_emails, error_message, created_at, started_at, completed_at, updated_at"
    )
    .limit(1);
  assertCampaignTable(error, "campaign_run_steps");
  assertNoError(error, "Failed to claim campaign step");
  const row = (data ?? [])[0] as CampaignRunStepRowRaw | undefined;
  return row ? normalizeCampaignRunStepRow(row) : null;
}

export async function setCampaignRunStepPending(params: {
  stepId: string;
  dueAt?: string;
  recipientEmails?: string[];
}): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("campaign_run_steps")
    .update({
      status: "pending",
      due_at: params.dueAt ?? new Date().toISOString(),
      recipient_emails: params.recipientEmails ?? [],
      blocking_send_job_id: null,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.stepId);
  assertCampaignTable(error, "campaign_run_steps");
  assertNoError(error, "Failed to mark campaign step pending");
}

export async function setCampaignRunStepWaiting(params: {
  stepId: string;
  blockingSendJobId: string;
}): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from("campaign_run_steps")
    .update({
      status: "waiting",
      blocking_send_job_id: params.blockingSendJobId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.stepId);
  assertCampaignTable(error, "campaign_run_steps");
  assertNoError(error, "Failed to mark campaign step waiting");
}

export async function setCampaignRunStepCompleted(stepId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from("campaign_run_steps")
    .update({
      status: "completed",
      completed_at: now,
      updated_at: now,
    })
    .eq("id", stepId);
  assertCampaignTable(error, "campaign_run_steps");
  assertNoError(error, "Failed to complete campaign step");
}

export async function setCampaignRunStepFailed(
  stepId: string,
  errorMessage: string
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from("campaign_run_steps")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", stepId);
  assertCampaignTable(error, "campaign_run_steps");
  assertNoError(error, "Failed to fail campaign step");
}

export async function failOpenCampaignRunSteps(
  runId: string,
  errorMessage: string
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from("campaign_run_steps")
    .update({
      status: "failed",
      error_message: errorMessage,
      completed_at: now,
      updated_at: now,
    })
    .eq("run_id", runId)
    .in("status", ["pending", "waiting", "processing"]);
  assertCampaignTable(error, "campaign_run_steps");
  assertNoError(error, "Failed to fail open campaign steps");
}

export async function markCampaignRunRunning(runId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from("campaign_runs")
    .update({
      status: "running",
      started_at: now,
      heartbeat_at: now,
      updated_at: now,
      error_message: null,
    })
    .eq("id", runId);
  assertCampaignTable(error, "campaign_runs");
  assertNoError(error, "Failed to mark campaign run running");
}

export async function markCampaignRunHeartbeat(runId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const { error } = await db
    .from("campaign_runs")
    .update({
      heartbeat_at: now,
      updated_at: now,
    })
    .eq("id", runId);
  assertCampaignTable(error, "campaign_runs");
  assertNoError(error, "Failed to heartbeat campaign run");
}

export async function setCampaignRunStatus(
  runId: string,
  status: CampaignRunStatus,
  errorMessage?: string | null
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    status,
    updated_at: now,
  };
  if (status === "completed" || status === "failed" || status === "cancelled") {
    payload.completed_at = now;
  }
  if (typeof errorMessage === "string") {
    payload.error_message = errorMessage;
  } else if (errorMessage === null) {
    payload.error_message = null;
  }

  const { error } = await db.from("campaign_runs").update(payload).eq("id", runId);
  assertCampaignTable(error, "campaign_runs");
  assertNoError(error, "Failed to update campaign run status");
}

export async function getSendJobStatusLite(
  jobId: string
): Promise<{ status: string } | null> {
  const db = getDb();
  const { data, error } = await db
    .from("send_jobs")
    .select("status")
    .eq("id", jobId)
    .limit(1);
  assertNoError(error, "Failed to read send job status");
  const row = (data ?? [])[0] as { status: string } | undefined;
  return row ?? null;
}

export async function getSentRecipientsForSendJob(
  jobId: string
): Promise<string[]> {
  const db = getDb();
  const { data, error } = await db
    .from("send_job_recipients")
    .select("recipient")
    .eq("job_id", jobId)
    .eq("status", "sent");
  assertNoError(error, "Failed to read sent campaign recipients");
  return Array.from(
    new Set(
      ((data ?? []) as Array<{ recipient: string }>)
        .map((row) => String(row.recipient ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}
