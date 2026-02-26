import {
  SESClient,
  SendEmailCommand,
  ListIdentitiesCommand,
  GetIdentityVerificationAttributesCommand,
} from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: process.env.AWS_REGION ?? "eu-west-3",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function listVerifiedDomains(): Promise<string[]> {
  const list = await ses.send(
    new ListIdentitiesCommand({ IdentityType: "Domain", MaxItems: 100 })
  );
  const identities = list.Identities ?? [];
  if (identities.length === 0) return [];

  const verification = await ses.send(
    new GetIdentityVerificationAttributesCommand({ Identities: identities })
  );
  const attrs = verification.VerificationAttributes ?? {};
  return identities.filter(
    (id) => attrs[id]?.VerificationStatus === "Success"
  );
}

function formatSourceAddress(from: string, fromName?: string): string {
  const normalizedName = (fromName ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedName) return from;

  const escapedName = normalizedName
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `"${escapedName}" <${from}>`;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendEmail({
  from,
  fromName,
  to,
  subject,
  html,
  configSet,
}: {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  html: string;
  configSet: string;
}) {
  const plainText = htmlToPlainText(html);
  const cmd = new SendEmailCommand({
    Source: formatSourceAddress(from, fromName),
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: {
        Html: { Data: html, Charset: "UTF-8" },
        Text: { Data: plainText, Charset: "UTF-8" },
      },
    },
    ConfigurationSetName: configSet,
  });
  return ses.send(cmd);
}
