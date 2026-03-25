import {
  type CampaignRunStatus,
  claimCampaignRunStep,
  createCampaignRun,
  createCampaignRunStep,
  failOpenCampaignRunSteps,
  getCampaignRunById,
  getCampaignRunForWorkspace,
  getCampaignWorkflowForWorkspace,
  getCampaignWorkflowById,
  getSendJobStatusLite,
  getSentRecipientsForSendJob,
  listPendingCampaignRunSteps,
  listWaitingCampaignRunSteps,
  markCampaignRunHeartbeat,
  markCampaignRunRunning,
  setCampaignRunStatus,
  setCampaignRunStepCompleted,
  setCampaignRunStepFailed,
  setCampaignRunStepPending,
  type CampaignRunStep,
} from "@/lib/campaign-db";
import {
  createSendJob,
  getDb,
  getContacts,
  getContactsByEmails,
  getWorkspaceSettings,
  insertSendJobRecipients,
} from "@/lib/db";
import {
  getOutgoingEdgesByNode,
  getRootNodeIds,
  isDelayNode,
  isRuleNode,
  isSendNode,
  sanitizeCampaignDraft,
  splitManualRecipients,
  type ConditionMatchMode,
  type FieldCondition,
  type HistoryCondition,
  type RecipientCondition,
  type SendAudience,
  type WorkflowNode,
} from "@/lib/campaign-workflows";

interface CandidateContact {
  email: string;
  fields: Record<string, string>;
}

interface RecipientHistoryRecord {
  subject: string;
  events: Set<string>;
}

export interface CampaignRunStartResult {
  runId: string;
  rootSteps: number;
}

export interface CampaignRunProcessSummary {
  waitingReleased: number;
  stepsClaimed: number;
  stepsCompleted: number;
  sendJobsCreated: number;
  runsCompleted: number;
  runsFailed: number;
  errors: string[];
}

interface CampaignProcessOptions {
  maxPendingSteps?: number;
  maxWaitingSteps?: number;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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
      : "Campaign step failed";
  return text.replace(/\s+/g, " ").trim().slice(0, 1000);
}

function normalizeFieldValue(
  fields: Record<string, string>,
  fieldName: string
): string {
  if (fieldName in fields) {
    return String(fields[fieldName] ?? "");
  }
  const normalizedFieldName = fieldName.trim().toLowerCase();
  for (const [key, value] of Object.entries(fields)) {
    if (key.trim().toLowerCase() === normalizedFieldName) {
      return String(value ?? "");
    }
  }
  return "";
}

function evaluateFieldCondition(
  contact: CandidateContact,
  condition: FieldCondition
): boolean {
  const actual = normalizeFieldValue(contact.fields, condition.field)
    .trim()
    .toLowerCase();
  const expected = condition.value.trim().toLowerCase();

  if (condition.operator === "equals") {
    return actual === expected;
  }
  if (condition.operator === "notEquals") {
    return actual !== expected;
  }
  if (condition.operator === "contains") {
    return actual.includes(expected);
  }
  return !actual.includes(expected);
}

function subjectMatchesHistoryCondition(
  subject: string,
  condition: HistoryCondition
): boolean {
  const actual = subject.trim().toLowerCase();
  const expected = condition.subject.trim().toLowerCase();
  if (!expected) {
    return false;
  }
  if (condition.subjectMatch === "contains") {
    return actual.includes(expected);
  }
  return actual === expected;
}

function evaluateHistoryCondition(
  historyRecords: RecipientHistoryRecord[],
  condition: HistoryCondition
): boolean {
  for (const record of historyRecords) {
    if (!subjectMatchesHistoryCondition(record.subject, condition)) {
      continue;
    }
    if (condition.eventType === "send") {
      return true;
    }
    if (record.events.has(condition.eventType)) {
      return true;
    }
  }
  return false;
}

async function loadCandidateContacts(
  workspaceId: string,
  recipientEmails: string[] | null
): Promise<CandidateContact[]> {
  if (!recipientEmails || recipientEmails.length === 0) {
    const contacts = await getContacts(workspaceId);
    return contacts.map((contact) => ({
      email: contact.email.toLowerCase(),
      fields: contact.fields,
    }));
  }

  const dedupedRecipients = Array.from(
    new Set(recipientEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))
  );
  const contacts = await getContactsByEmails(workspaceId, dedupedRecipients);
  const byEmail = new Map(
    contacts.map((contact) => [contact.email.toLowerCase(), contact.fields])
  );

  return dedupedRecipients.map((email) => ({
    email,
    fields: byEmail.get(email) ?? {},
  }));
}

async function loadRecipientHistory(
  workspaceId: string,
  recipientEmails: string[]
): Promise<Map<string, RecipientHistoryRecord[]>> {
  const historyByRecipient = new Map<string, RecipientHistoryRecord[]>();
  if (recipientEmails.length === 0) {
    return historyByRecipient;
  }

  const db = getDb();
  const recipientSet = new Set(recipientEmails.map((email) => email.toLowerCase()));
  const recipientChunks = chunkArray(Array.from(recipientSet), 200);
  const sendsByMessageId = new Map<
    string,
    { recipient: string; subject: string }
  >();
  const pageSize = 1000;
  for (const recipientChunk of recipientChunks) {
    let from = 0;

    while (true) {
      const { data, error } = await db
        .from("sends")
        .select("message_id, recipient, subject")
        .eq("workspace_id", workspaceId)
        .in("recipient", recipientChunk)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        throw new Error(`Failed to fetch campaign history sends: ${error.message}`);
      }

      const rows = (data ?? []) as Array<{
        message_id: string;
        recipient: string;
        subject: string;
      }>;
      if (rows.length === 0) break;

      for (const row of rows) {
        const recipient = String(row.recipient ?? "").trim().toLowerCase();
        if (!recipient || !recipientSet.has(recipient)) {
          continue;
        }
        const messageId = String(row.message_id ?? "").trim();
        if (!messageId) continue;
        sendsByMessageId.set(messageId, {
          recipient,
          subject: String(row.subject ?? ""),
        });
      }

      from += rows.length;
      if (rows.length < pageSize) break;
    }
  }

  if (sendsByMessageId.size === 0) {
    return historyByRecipient;
  }

  const eventsByMessageId = new Map<string, Set<string>>();
  const messageIds = Array.from(sendsByMessageId.keys());
  for (let index = 0; index < messageIds.length; index += 500) {
    const chunk = messageIds.slice(index, index + 500);
    const { data, error } = await db
      .from("email_events")
      .select("message_id, event_type")
      .in("message_id", chunk);
    if (error) {
      throw new Error(`Failed to fetch campaign history events: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{
      message_id: string;
      event_type: string | null;
    }>) {
      const messageId = String(row.message_id ?? "").trim();
      if (!messageId) continue;
      const events = eventsByMessageId.get(messageId) ?? new Set<string>();
      const eventType = String(row.event_type ?? "").trim().toLowerCase();
      if (eventType) {
        events.add(eventType);
      }
      eventsByMessageId.set(messageId, events);
    }
  }

  for (const [messageId, send] of sendsByMessageId.entries()) {
    const entries = historyByRecipient.get(send.recipient) ?? [];
    entries.push({
      subject: send.subject,
      events: eventsByMessageId.get(messageId) ?? new Set<string>(),
    });
    historyByRecipient.set(send.recipient, entries);
  }

  return historyByRecipient;
}

async function evaluateConditions(
  workspaceId: string,
  matchMode: ConditionMatchMode,
  conditions: RecipientCondition[],
  recipientEmails: string[] | null
): Promise<{ matched: string[]; unmatched: string[] }> {
  const contacts = await loadCandidateContacts(workspaceId, recipientEmails);
  if (contacts.length === 0) {
    return { matched: [], unmatched: [] };
  }
  if (conditions.length === 0) {
    return { matched: contacts.map((contact) => contact.email), unmatched: [] };
  }

  const historyConditions = conditions.filter(
    (condition): condition is HistoryCondition => condition.kind === "history"
  );
  const historyByRecipient =
    historyConditions.length > 0
      ? await loadRecipientHistory(
          workspaceId,
          contacts.map((contact) => contact.email)
        )
      : new Map<string, RecipientHistoryRecord[]>();

  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const contact of contacts) {
    const evaluations = conditions.map((condition) => {
      if (condition.kind === "field") {
        return evaluateFieldCondition(contact, condition);
      }
      return evaluateHistoryCondition(
        historyByRecipient.get(contact.email) ?? [],
        condition
      );
    });

    const passes =
      matchMode === "any"
        ? evaluations.some(Boolean)
        : evaluations.every(Boolean);
    if (passes) {
      matched.push(contact.email);
    } else {
      unmatched.push(contact.email);
    }
  }

  return { matched, unmatched };
}

async function resolveSendAudience(
  workspaceId: string,
  audience: SendAudience
): Promise<string[]> {
  if (audience.mode === "manual") {
    return splitManualRecipients(audience.manualTo);
  }

  const evaluation = await evaluateConditions(
    workspaceId,
    audience.matchMode,
    audience.conditions,
    null
  );
  return evaluation.matched;
}

function getBaseUrl(workspaceId: string): string {
  return (
    process.env.APP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    `https://${workspaceId}`
  );
}

function getDelayMs(node: WorkflowNode): number {
  if (!isDelayNode(node)) return 0;
  const days = Math.max(0, Math.floor(node.delayDays));
  const hours = Math.max(0, Math.floor(node.delayHours));
  return (days * 24 + hours) * 60 * 60 * 1000;
}

async function enqueueCampaignSendJob(params: {
  runId: string;
  stepId: string;
  campaignId: string;
  userId: string;
  workspaceId: string;
  billingBypass: boolean;
  node: Extract<WorkflowNode, { kind: "send" }>;
  recipients: string[];
}): Promise<string> {
  const workspaceSettings = await getWorkspaceSettings(params.workspaceId);
  const from =
    params.node.from.trim() ||
    workspaceSettings?.from_address?.trim() ||
    `noreply@${params.workspaceId}`;
  const subject = params.node.subject.trim();
  const html = params.node.html.trim();

  if (!subject || !html) {
    throw new Error("Send nodes require both a subject and HTML body");
  }

  const configSet =
    workspaceSettings?.config_set?.trim() || "email-tracking-config-set";
  const rateLimit = normalizeNonNegativeInteger(
    workspaceSettings?.rate_limit,
    300
  );
  const websiteUrl =
    workspaceSettings?.website_url?.trim() || `https://${params.workspaceId}`;
  const footerHtml = workspaceSettings?.footer_html ?? "";

  const jobId = await createSendJob({
    userId: params.userId,
    payload: {
      workspaceId: params.workspaceId,
      from,
      fromName: workspaceSettings?.from_name ?? "",
      subject,
      html,
      configSet,
      rateLimit,
      footerHtml,
      websiteUrl,
      baseUrl: getBaseUrl(params.workspaceId),
      billingBypass: params.billingBypass,
    },
    totalRecipients: params.recipients.length,
    rateLimit,
    batchSize: normalizePositiveInteger(process.env.SEND_JOB_BATCH_SIZE ?? 50, 50),
    sendConcurrency: normalizePositiveInteger(
      process.env.SEND_JOB_CONCURRENCY ?? 4,
      4
    ),
    dryRun: false,
    campaignId: params.campaignId,
    campaignRunId: params.runId,
    campaignStepId: params.stepId,
  });

  await insertSendJobRecipients(jobId, params.recipients);
  return jobId;
}

async function syncCampaignRunStatus(runId: string): Promise<CampaignRunStatus | null> {
  const run = await getCampaignRunById(runId);
  if (!run) return null;
  if (
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "completed"
  ) {
    return run.status;
  }

  const progress = await getCampaignRunForWorkspace(run.id, run.workspaceId);
  if (!progress) return null;

  if (progress.stepCounts.failed > 0) {
    await setCampaignRunStatus(
      run.id,
      "failed",
      progress.errorMessage ?? "Campaign run failed"
    );
    return "failed";
  }

  if (progress.stepCounts.processing > 0 || progress.stepCounts.pending > 0) {
    await setCampaignRunStatus(run.id, "running", null);
    return "running";
  }

  if (progress.stepCounts.waiting > 0) {
    await setCampaignRunStatus(run.id, "waiting", null);
    return "waiting";
  }

  await setCampaignRunStatus(run.id, "completed", null);
  return "completed";
}

async function releaseWaitingStep(step: CampaignRunStep): Promise<boolean> {
  if (!step.blockingSendJobId) {
    await setCampaignRunStepPending({
      stepId: step.id,
      dueAt: new Date().toISOString(),
      recipientEmails: step.recipientEmails,
    });
    return true;
  }

  const job = await getSendJobStatusLite(step.blockingSendJobId);
  if (
    !job ||
    !["completed", "failed", "cancelled"].includes(job.status.trim().toLowerCase())
  ) {
    return false;
  }

  const sentRecipients = await getSentRecipientsForSendJob(step.blockingSendJobId);
  await setCampaignRunStepPending({
    stepId: step.id,
    dueAt: new Date().toISOString(),
    recipientEmails: sentRecipients,
  });
  return true;
}

async function processClaimedStep(
  step: CampaignRunStep,
  summary: CampaignRunProcessSummary
): Promise<void> {
  const run = await getCampaignRunById(step.runId);
  if (!run) {
    await setCampaignRunStepFailed(step.id, "Campaign run not found");
    summary.stepsCompleted += 1;
    return;
  }

  if (
    run.status === "failed" ||
    run.status === "cancelled" ||
    run.status === "completed"
  ) {
    await setCampaignRunStepFailed(
      step.id,
      `Campaign run is already ${run.status}`
    );
    summary.stepsCompleted += 1;
    return;
  }

  const campaign = await getCampaignWorkflowById(run.campaignId);
  if (!campaign) {
    const message = "Campaign definition not found";
    await setCampaignRunStepFailed(step.id, message);
    await failOpenCampaignRunSteps(run.id, message);
    await setCampaignRunStatus(run.id, "failed", message);
    summary.stepsCompleted += 1;
    return;
  }

  const draft = sanitizeCampaignDraft(campaign);
  const nodeById = new Map(draft.nodes.map((node) => [node.id, node]));
  const outgoingEdgesByNode = getOutgoingEdgesByNode(draft.edges);
  const node = nodeById.get(step.nodeId);
  if (!node) {
    const message = "Workflow node not found";
    await setCampaignRunStepFailed(step.id, message);
    await failOpenCampaignRunSteps(run.id, message);
    await setCampaignRunStatus(run.id, "failed", message);
    summary.stepsCompleted += 1;
    return;
  }

  if (!run.startedAt) {
    await markCampaignRunRunning(run.id);
  } else {
    await setCampaignRunStatus(run.id, "running", null);
    await markCampaignRunHeartbeat(run.id);
  }

  if (isSendNode(node)) {
    const recipients =
      step.recipientEmails.length > 0
        ? step.recipientEmails
        : await resolveSendAudience(run.workspaceId, node.audience);

    if (recipients.length > 0) {
      const sendJobId = await enqueueCampaignSendJob({
        runId: run.id,
        stepId: step.id,
        campaignId: run.campaignId,
        userId: run.userId,
        workspaceId: run.workspaceId,
        billingBypass: run.billingBypass,
        node,
        recipients,
      });
      summary.sendJobsCreated += 1;

      for (const edge of outgoingEdgesByNode.get(node.id) ?? []) {
        await createCampaignRunStep({
          runId: run.id,
          nodeId: edge.toNodeId,
          status: "waiting",
          blockingSendJobId: sendJobId,
          recipientEmails: recipients,
        });
      }
    }

    await setCampaignRunStepCompleted(step.id);
    summary.stepsCompleted += 1;
    return;
  }

  if (isDelayNode(node)) {
    const dueAt = new Date(Date.now() + getDelayMs(node)).toISOString();
    for (const edge of outgoingEdgesByNode.get(node.id) ?? []) {
      await createCampaignRunStep({
        runId: run.id,
        nodeId: edge.toNodeId,
        dueAt,
        recipientEmails: step.recipientEmails,
      });
    }

    await setCampaignRunStepCompleted(step.id);
    summary.stepsCompleted += 1;
    return;
  }

  if (isRuleNode(node)) {
    const evaluation = await evaluateConditions(
      run.workspaceId,
      node.matchMode,
      node.conditions,
      step.recipientEmails.length > 0 ? step.recipientEmails : null
    );

    for (const edge of outgoingEdgesByNode.get(node.id) ?? []) {
      const recipients =
        edge.port === "true"
          ? evaluation.matched
          : edge.port === "false"
          ? evaluation.unmatched
          : [];
      if (recipients.length === 0) {
        continue;
      }
      await createCampaignRunStep({
        runId: run.id,
        nodeId: edge.toNodeId,
        recipientEmails: recipients,
      });
    }

    await setCampaignRunStepCompleted(step.id);
    summary.stepsCompleted += 1;
    return;
  }

  await setCampaignRunStepCompleted(step.id);
  summary.stepsCompleted += 1;
}

export async function startCampaignRun(params: {
  workspaceId: string;
  campaignId: string;
  userId: string;
  billingBypass: boolean;
}): Promise<CampaignRunStartResult> {
  const campaign = await getCampaignWorkflowForWorkspace(
    params.workspaceId,
    params.campaignId
  );
  if (!campaign) {
    throw new Error("Campaign not found");
  }

  const draft = sanitizeCampaignDraft(campaign);
  if (draft.nodes.length === 0) {
    throw new Error("Campaign has no workflow nodes");
  }

  const run = await createCampaignRun({
    campaignId: params.campaignId,
    workspaceId: params.workspaceId,
    userId: params.userId,
    billingBypass: params.billingBypass,
  });

  const rootNodeIds = getRootNodeIds(draft);
  const initialNodeIds =
    rootNodeIds.length > 0 ? rootNodeIds : [draft.nodes[0].id];

  for (const nodeId of initialNodeIds) {
    await createCampaignRunStep({
      runId: run.id,
      nodeId,
    });
  }

  return {
    runId: run.id,
    rootSteps: initialNodeIds.length,
  };
}

export async function processCampaignRuns(
  options: CampaignProcessOptions = {}
): Promise<CampaignRunProcessSummary> {
  const summary: CampaignRunProcessSummary = {
    waitingReleased: 0,
    stepsClaimed: 0,
    stepsCompleted: 0,
    sendJobsCreated: 0,
    runsCompleted: 0,
    runsFailed: 0,
    errors: [],
  };

  const waitingSteps = await listWaitingCampaignRunSteps(
    normalizePositiveInteger(options.maxWaitingSteps, 10)
  );
  for (const waitingStep of waitingSteps) {
    try {
      const released = await releaseWaitingStep(waitingStep);
      if (released) {
        summary.waitingReleased += 1;
        const status = await syncCampaignRunStatus(waitingStep.runId);
        if (status === "completed") {
          summary.runsCompleted += 1;
        } else if (status === "failed") {
          summary.runsFailed += 1;
        }
      }
    } catch (error) {
      summary.errors.push(trimMessage(error));
    }
  }

  const pendingSteps = await listPendingCampaignRunSteps(
    new Date().toISOString(),
    normalizePositiveInteger(options.maxPendingSteps, 10)
  );

  for (const pendingStep of pendingSteps) {
    const claimed = await claimCampaignRunStep(pendingStep.id);
    if (!claimed) {
      continue;
    }

    summary.stepsClaimed += 1;
    try {
      await processClaimedStep(claimed, summary);
      const status = await syncCampaignRunStatus(claimed.runId);
      if (status === "completed") {
        summary.runsCompleted += 1;
      } else if (status === "failed") {
        summary.runsFailed += 1;
      }
    } catch (error) {
      const message = trimMessage(error);
      summary.errors.push(message);
      await setCampaignRunStepFailed(claimed.id, message).catch(() => {
        // no-op
      });
      await failOpenCampaignRunSteps(claimed.runId, message).catch(() => {
        // no-op
      });
      await setCampaignRunStatus(claimed.runId, "failed", message).catch(() => {
        // no-op
      });
      summary.stepsCompleted += 1;
      summary.runsFailed += 1;
    }
  }

  return summary;
}
