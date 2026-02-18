import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/ses";
import { insertSend, getContacts, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";
import { appendWorkspaceFooter } from "@/lib/email-footer";
import { buildUnsubscribeUrl } from "@/lib/unsubscribe";

interface SendBody {
  workspaceId: string;
  from: string;
  to: string[];
  recipientMode?: "manual" | "all_contacts" | "verified_contacts" | "unverified_contacts";
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

function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const email = value.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(email);
  }

  return unique;
}

function parseBooleanLike(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["true", "1", "yes", "y", "verified"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "unverified"].includes(normalized)) return false;
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = (await req.json()) as SendBody;
    const {
      workspaceId,
      from,
      to,
      recipientMode: rawRecipientMode,
      subject,
      html,
      dryRun,
      configSet,
      rateLimit,
      footerHtml,
      websiteUrl,
    } = body;

    if (!workspaceId || !from || !subject || !html) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const hasAccess = await userCanAccessWorkspace(user.id, workspaceId);
    if (!hasAccess) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
    }

    const fromDomain = from.includes("@") ? from.split("@")[1] : from;
    if (fromDomain && fromDomain !== workspaceId) {
      return NextResponse.json(
        { error: "From address does not match workspace" },
        { status: 400 }
      );
    }

    const baseUrl =
      process.env.APP_BASE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      req.nextUrl.origin;

    const recipientMode = normalizeRecipientMode(rawRecipientMode);
    const delay = Math.max(0, rateLimit ?? 300);
    let sent = 0;
    const errorEmails: string[] = [];

    const contactList = await getContacts(workspaceId);
    const contactMap = new Map(
      contactList.map((c) => [c.email.toLowerCase(), c])
    );

    const recipients = (() => {
      if (recipientMode === "all_contacts") {
        return uniqueEmails(contactList.map((contact) => contact.email));
      }
      if (recipientMode === "verified_contacts") {
        return uniqueEmails(
          contactList
            .filter(
              (contact) => parseBooleanLike(contact.fields.verified) === true
            )
            .map((contact) => contact.email)
        );
      }
      if (recipientMode === "unverified_contacts") {
        return uniqueEmails(
          contactList
            .filter(
              (contact) => parseBooleanLike(contact.fields.verified) === false
            )
            .map((contact) => contact.email)
        );
      }
      return uniqueEmails(Array.isArray(to) ? to : []);
    })();

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: "No recipients resolved for this send" },
        { status: 400 }
      );
    }

    if (dryRun) {
      return NextResponse.json({ sent: recipients.length, dryRun: true });
    }

    for (let index = 0; index < recipients.length; index++) {
      const recipient = recipients[index];

      // Replace template variables per recipient
      const contact = contactMap.get(recipient.toLowerCase());
      const vars: Record<string, string> = {
        email: recipient,
        ...(contact?.fields ?? {}),
      };
      const basePersonalizedHtml = html.replace(
        /\{\{(\w+)\}\}/g,
        (_, key) => vars[key.toLowerCase()] ?? `{{${key}}}`
      );
      const unsubscribeUrl = buildUnsubscribeUrl({
        baseUrl,
        workspaceId,
        email: recipient,
      });
      const personalizedHtml = appendWorkspaceFooter({
        html: basePersonalizedHtml,
        footerHtml: footerHtml ?? "",
        websiteUrl: websiteUrl ?? "",
        workspaceId,
        unsubscribeUrl,
      });
      const personalizedSubject = subject.replace(
        /\{\{(\w+)\}\}/g,
        (_, key) => vars[key.toLowerCase()] ?? `{{${key}}}`
      );

      try {
        const result = await sendEmail({
          from,
          to: recipient,
          subject: personalizedSubject,
          html: personalizedHtml,
          configSet,
        });
        sent++;
        if (result.MessageId) {
          try {
            await insertSend(workspaceId, result.MessageId, recipient, subject);
          } catch (dbErr) {
            console.error(`Failed to record send for ${recipient}:`, dbErr);
          }
        }
      } catch (err) {
        console.error(`Failed to send to ${recipient}:`, err);
        errorEmails.push(recipient);
      }
      if (index < recipients.length - 1) {
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    return NextResponse.json({
      sent,
      errors: errorEmails.length,
      errorEmails,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
