import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/ses";

interface SendBody {
  from: string;
  to: string[];
  subject: string;
  html: string;
  dryRun: boolean;
  configSet: string;
  rateLimit: number;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as SendBody;
  const { from, to, subject, html, dryRun, configSet, rateLimit } = body;

  if (!from || !to?.length || !subject || !html) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  if (dryRun) {
    return NextResponse.json({ sent: to.length, dryRun: true });
  }

  const delay = Math.max(0, rateLimit ?? 300);
  let sent = 0;
  const errorEmails: string[] = [];

  for (const recipient of to) {
    try {
      await sendEmail({ from, to: recipient, subject, html, configSet });
      sent++;
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
}
