import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/ses";
import { insertSend, getContacts, userCanAccessWorkspace } from "@/lib/db";
import { apiErrorResponse, requireAuthenticatedUser } from "@/lib/auth";

interface SendBody {
  workspaceId: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  dryRun: boolean;
  configSet: string;
  rateLimit: number;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(req);
    const body = (await req.json()) as SendBody;
    const { workspaceId, from, to, subject, html, dryRun, configSet, rateLimit } = body;

    if (!workspaceId || !from || !to?.length || !subject || !html) {
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

    if (dryRun) {
      return NextResponse.json({ sent: to.length, dryRun: true });
    }

    const delay = Math.max(0, rateLimit ?? 300);
    let sent = 0;
    const errorEmails: string[] = [];

    // Build contact lookup for template variables
    const contactList = await getContacts(workspaceId);
    const contactMap = new Map(contactList.map((c) => [c.email, c]));

    for (const recipient of to) {
      // Replace template variables per recipient
      const contact = contactMap.get(recipient);
      const vars: Record<string, string> = {
        email: recipient,
        ...(contact?.fields ?? {}),
      };
      const personalizedHtml = html.replace(
        /\{\{(\w+)\}\}/g,
        (_, key) => vars[key.toLowerCase()] ?? `{{${key}}}`
      );
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
      if (to.indexOf(recipient) < to.length - 1) {
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
