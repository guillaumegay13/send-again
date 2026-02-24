import { after, NextRequest, NextResponse } from "next/server";
import {
  createSendJob,
  failSendJobWithMessage,
  getContacts,
  getUnsubscribedEmailSet,
  userCanAccessWorkspace,
  insertSendJobRecipients,
} from "@/lib/db";
import { processSendJobs } from "@/lib/send-job-processor";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

interface SendBody {
  workspaceId: string;
  from: string;
  to: string[];
  recipientMode?: RecipientMode;
  subject: string;
  html: string;
  dryRun: boolean;
  configSet: string;
  rateLimit: number;
  footerHtml: string;
  websiteUrl: string;
}

type RecipientMode =
  | "manual"
  | "all_contacts"
  | "verified_contacts"
  | "unverified_contacts";

function normalizeRecipientMode(value: unknown): RecipientMode {
  if (value === "all_contacts") return "all_contacts";
  if (value === "verified_contacts") return "verified_contacts";
  if (value === "unverified_contacts") return "unverified_contacts";
  return "manual";
}

function normalizeRateLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 300;
  return Math.max(0, Math.floor(parsed));
}

function normalizeConcurrency(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 4;
  return Math.max(1, Math.floor(parsed));
}

function parseBooleanLike(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["true", "1", "yes", "y", "verified"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "unverified"].includes(normalized)) return false;
  return null;
}

function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const email = value.trim().toLowerCase();
    if (!email) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    unique.push(email);
  }

  return unique;
}

function normalizeSendRequestBody(raw: unknown): SendBody {
  const body = (raw ?? {}) as Record<string, unknown>;

  const workspaceId = String(body.workspaceId ?? "").trim().toLowerCase();
  const from = String(body.from ?? "").trim();
  const subject = String(body.subject ?? "").trim();
  const html = String(body.html ?? "").trim();
  const footerHtml = String(body.footerHtml ?? "");
  const websiteUrl = String(body.websiteUrl ?? "");
  const rateLimit = normalizeRateLimit(body.rateLimit);
  const configSet = String(body.configSet ?? "email-tracking-config-set").trim();
  const recipientMode = normalizeRecipientMode(body.recipientMode);
  const dryRun = typeof body.dryRun === "boolean" ? body.dryRun : false;
  const to = Array.isArray(body.to)
    ? (body.to.filter((value): value is string => typeof value === "string") as string[])
    : [];

  return {
    workspaceId,
    from,
    to,
    recipientMode,
    subject,
    html,
    dryRun,
    configSet,
    rateLimit,
    footerHtml,
    websiteUrl,
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = normalizeSendRequestBody(await req.json());
    const hasAccess = await userCanAccessWorkspace(user.id, body.workspaceId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    if (
      !body.workspaceId ||
      !body.from ||
      !body.subject ||
      !body.html ||
      !body.configSet
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!/^\S+@\S+\.\S+$/.test(body.from)) {
      return NextResponse.json({ error: "Invalid from address" }, { status: 400 });
    }

    const fromDomain = body.from.split("@")[1]?.toLowerCase() ?? "";
    if (fromDomain !== body.workspaceId.toLowerCase()) {
      return NextResponse.json(
        { error: "From address does not match workspace" },
        { status: 400 }
      );
    }

    const recipientMode = body.recipientMode;

    let recipients: string[] = [];
    if (recipientMode === "manual") {
      recipients = uniqueEmails(body.to);
    } else {
      const contacts = await getContacts(body.workspaceId);
      if (contacts.length > 0) {
        if (recipientMode === "all_contacts") {
          recipients = uniqueEmails(contacts.map((contact) => contact.email));
        }
        if (recipientMode === "verified_contacts") {
          recipients = uniqueEmails(
            contacts
              .filter(
                (contact) => parseBooleanLike(contact.fields.verified) === true
              )
              .map((contact) => contact.email)
          );
        }
        if (recipientMode === "unverified_contacts") {
          recipients = uniqueEmails(
            contacts
              .filter(
                (contact) => parseBooleanLike(contact.fields.verified) === false
              )
              .map((contact) => contact.email)
          );
        }
      }
    }

    const unsubscribed = await getUnsubscribedEmailSet(
      body.workspaceId,
      recipients
    );
    if (unsubscribed.size > 0) {
      recipients = recipients.filter((email) => !unsubscribed.has(email));
    }

    if (recipients.length === 0) {
      return NextResponse.json(
        {
          error:
            unsubscribed.size > 0
              ? "All resolved recipients are unsubscribed"
              : "No recipients resolved for this send",
        },
        { status: 400 }
      );
    }

    const baseUrl =
      process.env.APP_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      req.nextUrl.origin;

    const payload = {
      workspaceId: body.workspaceId,
      from: body.from,
      subject: body.subject,
      html: body.html,
      configSet: body.configSet,
      rateLimit: body.rateLimit,
      footerHtml: body.footerHtml,
      websiteUrl: body.websiteUrl,
      baseUrl,
    };

    if (body.dryRun) {
      return NextResponse.json({
        sent: recipients.length,
        skippedUnsubscribed: unsubscribed.size,
        dryRun: true,
      });
    }

    const jobId = await createSendJob({
      userId: user.id,
      payload,
      totalRecipients: recipients.length,
      rateLimit: body.rateLimit,
      batchSize: normalizeNonNegativeInteger(
        process.env.SEND_JOB_BATCH_SIZE ?? 50,
        50,
        1
      ),
      sendConcurrency: normalizeConcurrency(process.env.SEND_JOB_CONCURRENCY ?? 4),
      dryRun: false,
    });

    try {
      await insertSendJobRecipients(jobId, recipients);
    } catch (error) {
      await failSendJobWithMessage(
        jobId,
        "Failed to persist recipient list for job"
      ).catch(() => {
        // no-op
      });
      throw error;
    }

    // Continue processing after the HTTP response lifecycle (Vercel/Next.js supported).
    after(async () => {
      try {
        const maxIterations = normalizeNonNegativeInteger(
          process.env.SEND_JOB_AFTER_MAX_ITERATIONS ?? 20,
          20,
          1
        );
        for (let i = 0; i < maxIterations; i += 1) {
          const summary = await processSendJobs();
          if (summary.recipientsProcessed <= 0) {
            break;
          }
        }
      } catch (err) {
        console.error("Background processSendJobs error:", err);
      }
    });

    return NextResponse.json({
      jobId,
      status: "queued",
      total: recipients.length,
      skippedUnsubscribed: unsubscribed.size,
      dryRun: false,
    });
  } catch (error) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return apiErrorResponse(error, "Failed to start send job");
  }
}

function normalizeNonNegativeInteger(
  value: unknown,
  fallback: number,
  min = 0
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}
