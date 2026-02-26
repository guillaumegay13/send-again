import { sendEmail } from "@/lib/ses";
import { appendWorkspaceFooter } from "@/lib/email-footer";
import { buildUnsubscribeUrl } from "@/lib/unsubscribe";
import {
  claimQueuedSendJob,
  claimRunningSendJob,
  claimStaleRunningSendJob,
  countSendJobRecipientsByStatus,
  getContactsByEmails,
  getQueuedOrRunningSendJobs,
  getSendJobWorkerContext,
  incrementSendJobProgress,
  insertSend,
  markSendJobHeartbeat,
  markSendJobRecipientFailed,
  markSendJobRecipientSent,
  requeueStaleSendingRecipients,
  claimSendJobRecipients,
  setSendJobCompleted,
  getPendingSendJobRecipients,
  failSendJobWithMessage,
  getUnsubscribedEmailSet,
} from "@/lib/db";

interface SendJobProcessOptions {
  maxJobs?: number;
  maxRecipientsPerJob?: number;
  staleJobMs?: number;
  staleRecipientMs?: number;
}

export interface SendJobProcessSummary {
  jobsClaimed: number;
  jobsCompleted: number;
  recipientsProcessed: number;
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

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key.toLowerCase()] ?? `{{${key}}}`;
  });
}

function isRunningJobStale(
  heartbeatAt: string | null,
  startedAt: string | null,
  staleCutoffIso: string
): boolean {
  const heartbeatTime = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
  if (Number.isFinite(heartbeatTime)) {
    return heartbeatTime <= Date.parse(staleCutoffIso);
  }

  const startedTime = startedAt ? Date.parse(startedAt) : NaN;
  if (Number.isFinite(startedTime)) {
    return startedTime <= Date.parse(staleCutoffIso);
  }

  return false;
}

function chunk<T>(rows: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    groups.push(rows.slice(i, i + size));
  }
  return groups;
}

function trimMessage(value: unknown): string {
  const text =
    typeof value === "string"
      ? value
      : value instanceof Error
      ? value.message
      : "Failed to send email";

  return text.replace(/\s+/g, " ").trim().slice(0, 1000);
}

export async function processSendJobs(
  options: SendJobProcessOptions = {}
): Promise<SendJobProcessSummary> {
  const maxJobs = normalizePositiveInteger(
    options.maxJobs,
    normalizePositiveInteger(process.env.SEND_JOB_MAX_JOBS, 1)
  );
  const maxRecipientsPerJob = normalizePositiveInteger(
    options.maxRecipientsPerJob,
    normalizePositiveInteger(process.env.SEND_JOB_MAX_RECIPIENTS_PER_JOB, 250)
  );
  const staleJobMs = normalizeNonNegativeInteger(
    options.staleJobMs,
    normalizeNonNegativeInteger(process.env.SEND_JOB_STALE_MS, 180000)
  );
  const staleRecipientMs = normalizeNonNegativeInteger(
    options.staleRecipientMs,
    normalizeNonNegativeInteger(process.env.SEND_JOB_STALE_RECIPIENT_MS, 180000)
  );

  const summary: SendJobProcessSummary = {
    jobsClaimed: 0,
    jobsCompleted: 0,
    recipientsProcessed: 0,
    errors: [],
  };

  const candidates = await getQueuedOrRunningSendJobs(maxJobs);
  if (candidates.length === 0) {
    return summary;
  }

  const staleCutoff = new Date(Date.now() - staleJobMs).toISOString();

  for (const candidate of candidates) {
    try {
      const canClaimQueued = candidate.status === "queued";
      const isRunning = candidate.status === "running";
      const isStaleRunning =
        isRunning &&
        isRunningJobStale(
          candidate.heartbeat_at,
          candidate.started_at,
          staleCutoff
        );

      let claimed = false;
      if (canClaimQueued) {
        claimed = await claimQueuedSendJob(candidate.id);
      } else if (isRunning) {
        claimed = isStaleRunning
          ? await claimStaleRunningSendJob(
              candidate.id,
              candidate.heartbeat_at ?? null
            )
          : await claimRunningSendJob(candidate.id, candidate.heartbeat_at ?? null);
      }

      if (!claimed) {
        continue;
      }

      summary.jobsClaimed += 1;
      const processed = await processSendJob(candidate.id, {
        maxRecipientsPerJob,
        staleRecipientMs,
      });
      summary.recipientsProcessed += processed;
      if (processed > 0) {
        await markSendJobHeartbeat(candidate.id);
      }
      const remainingPending = await countSendJobRecipientsByStatus(
        candidate.id,
        "pending"
      );
      const remainingSending = await countSendJobRecipientsByStatus(
        candidate.id,
        "sending"
      );
      if (remainingPending === 0 && remainingSending === 0) {
        await setSendJobCompleted(candidate.id, "completed");
        summary.jobsCompleted += 1;
      }
    } catch (error) {
      summary.errors.push(trimMessage(error));
      await failSendJobWithMessage(candidate.id, trimMessage(error)).catch(() => {
        // no-op
      });
    }
  }

  return summary;
}

async function processSendJob(
  jobId: string,
  params: {
    maxRecipientsPerJob: number;
    staleRecipientMs: number;
  }
): Promise<number> {
  const context = await getSendJobWorkerContext(jobId);
  if (!context) {
    throw new Error("Missing job context");
  }

  if (context.status !== "running" && context.status !== "queued") {
    return 0;
  }

  const staleRecipientCutoff = new Date(
    Date.now() - params.staleRecipientMs
  ).toISOString();
  await requeueStaleSendingRecipients(jobId, staleRecipientCutoff);

  let processed = 0;
  const maxRecipientsPerJob = Math.max(1, params.maxRecipientsPerJob);

  while (processed < maxRecipientsPerJob) {
    const remainingBudget = maxRecipientsPerJob - processed;
    const batchLimit = Math.min(context.batchSize, remainingBudget);
    const recipients = await getPendingSendJobRecipients(jobId, batchLimit);

    if (recipients.length === 0) {
      return processed;
    }

    let claimedRecipients = await claimSendJobRecipients(
      jobId,
      recipients.map((recipient) => recipient.id)
    );

    if (claimedRecipients.length === 0) {
      return processed;
    }

    const unsubscribed = await getUnsubscribedEmailSet(
      context.workspaceId,
      claimedRecipients.map((recipient) => recipient.recipient)
    );
    if (unsubscribed.size > 0) {
      const suppressedRecipients = claimedRecipients.filter((recipient) =>
        unsubscribed.has(recipient.recipient.toLowerCase())
      );
      if (suppressedRecipients.length > 0) {
        await Promise.all(
          suppressedRecipients.map((recipient) =>
            markSendJobRecipientFailed(recipient.id, "Recipient unsubscribed")
          )
        );
        await incrementSendJobProgress(jobId, 0, suppressedRecipients.length);
        processed += suppressedRecipients.length;
      }
      claimedRecipients = claimedRecipients.filter(
        (recipient) => !unsubscribed.has(recipient.recipient.toLowerCase())
      );
    }

    if (claimedRecipients.length === 0) {
      if (context.rateLimit > 0 && processed < maxRecipientsPerJob) {
        await wait(context.rateLimit);
      }
      continue;
    }

    const recipientEmails = claimedRecipients.map(
      (recipient) => recipient.recipient
    );
    const contacts = await getContactsByEmails(context.workspaceId, recipientEmails);
    const contactMap = new Map(
      contacts.map((contact) => [contact.email.toLowerCase(), contact])
    );

    let sent = 0;
    let failed = 0;
    const waves = chunk(claimedRecipients, Math.max(1, context.sendConcurrency));
    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const wave = waves[waveIndex];
      const waveResult = await Promise.all(
        wave.map(async (recipient) => {
          const contact = contactMap.get(recipient.recipient.toLowerCase());
          const vars = {
            email: recipient.recipient,
            ...(contact?.fields ?? {}),
          };
          const subject = renderTemplate(context.payload.subject, vars);
          const baseHtml = renderTemplate(context.payload.html, vars);
          const unsubscribeUrl = buildUnsubscribeUrl({
            baseUrl: context.payload.baseUrl,
            workspaceId: context.workspaceId,
            email: recipient.recipient,
          });
          const html = appendWorkspaceFooter({
            html: baseHtml,
            footerHtml: context.payload.footerHtml,
            websiteUrl: context.payload.websiteUrl,
            workspaceId: context.workspaceId,
            unsubscribeUrl,
          });

          try {
            const result = await sendEmail({
              from: context.payload.from,
              fromName: context.payload.fromName,
              to: recipient.recipient,
              subject,
              html,
              configSet: context.payload.configSet,
              unsubscribeUrl,
            });

            const messageId = result.MessageId ?? null;
            await markSendJobRecipientSent(recipient.id, messageId);
            if (messageId) {
              await insertSend(
                context.workspaceId,
                messageId,
                recipient.recipient,
                subject
              ).catch(() => {
                // best effort, sending still counts as sent
              });
            }

            return { ok: true };
          } catch (error) {
            const message = trimMessage(error);
            await markSendJobRecipientFailed(recipient.id, message);
            return { ok: false };
          }
        })
      );

      sent += waveResult.filter((result) => result.ok).length;
      failed += waveResult.filter((result) => !result.ok).length;

      if (context.rateLimit > 0 && waveIndex < waves.length - 1) {
        await wait(context.rateLimit);
      }
    }

    await incrementSendJobProgress(jobId, sent, failed);
    processed += sent + failed;

    if (context.rateLimit > 0 && processed < maxRecipientsPerJob) {
      await wait(context.rateLimit);
    }
  }

  return processed;
}
