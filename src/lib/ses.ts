import {
  SESClient,
  SendRawEmailCommand,
  ListIdentitiesCommand,
  GetIdentityVerificationAttributesCommand,
  GetIdentityDkimAttributesCommand,
  VerifyDomainIdentityCommand,
  VerifyDomainDkimCommand,
  CreateConfigurationSetCommand,
  DescribeConfigurationSetCommand,
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

export async function verifyDomain(domain: string): Promise<string> {
  const res = await ses.send(
    new VerifyDomainIdentityCommand({ Domain: domain })
  );
  return res.VerificationToken ?? "";
}

export type SetupStatus = "NotStarted" | "Pending" | "Success" | "Failed";

export interface DomainSetupStatus {
  verificationToken: string | null;
  verificationStatus: SetupStatus;
  dkimTokens: string[];
  dkimStatus: SetupStatus;
}

export async function getDomainSetupStatus(
  domain: string
): Promise<DomainSetupStatus> {
  const [verif, dkim] = await Promise.all([
    ses.send(
      new GetIdentityVerificationAttributesCommand({ Identities: [domain] })
    ),
    ses.send(
      new GetIdentityDkimAttributesCommand({ Identities: [domain] })
    ),
  ]);

  const verifAttrs = verif.VerificationAttributes?.[domain];
  const dkimAttrs = dkim.DkimAttributes?.[domain];

  return {
    verificationToken: verifAttrs?.VerificationToken ?? null,
    verificationStatus: (verifAttrs?.VerificationStatus as SetupStatus) ?? "NotStarted",
    dkimTokens: dkimAttrs?.DkimTokens ?? [],
    dkimStatus: dkimAttrs?.DkimVerificationStatus
      ? (dkimAttrs.DkimVerificationStatus as SetupStatus)
      : "NotStarted",
  };
}

export async function setupDkim(domain: string): Promise<string[]> {
  const res = await ses.send(new VerifyDomainDkimCommand({ Domain: domain }));
  return res.DkimTokens ?? [];
}

export async function createConfigurationSet(name: string): Promise<void> {
  await ses.send(
    new CreateConfigurationSetCommand({
      ConfigurationSet: { Name: name },
    })
  );
}

export async function configurationSetExists(name: string): Promise<boolean> {
  try {
    await ses.send(
      new DescribeConfigurationSetCommand({ ConfigurationSetName: name })
    );
    return true;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      err.name === "ConfigurationSetDoesNotExistException"
    ) {
      return false;
    }
    throw err;
  }
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

function buildRawMessage({
  from,
  to,
  subject,
  html,
  plainText,
  unsubscribeUrl,
}: {
  from: string;
  to: string;
  subject: string;
  html: string;
  plainText: string;
  unsubscribeUrl?: string;
}): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // Encode subject for UTF-8 support
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;

  let headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  if (unsubscribeUrl) {
    headers.push(`List-Unsubscribe: <${unsubscribeUrl}>`);
    headers.push(`List-Unsubscribe-Post: List-Unsubscribe=One-Click`);
  }

  const body = [
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(plainText).toString("base64"),
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(html).toString("base64"),
    `--${boundary}--`,
  ];

  return [...headers, ``, ...body].join("\r\n");
}

export async function sendEmail({
  from,
  fromName,
  to,
  subject,
  html,
  configSet,
  unsubscribeUrl,
}: {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  html: string;
  configSet: string;
  unsubscribeUrl?: string;
}) {
  const plainText = htmlToPlainText(html);
  const source = formatSourceAddress(from, fromName);

  const rawMessage = buildRawMessage({
    from: source,
    to,
    subject,
    html,
    plainText,
    unsubscribeUrl,
  });

  const cmd = new SendRawEmailCommand({
    RawMessage: { Data: new Uint8Array(Buffer.from(rawMessage)) },
    Source: source,
    Destinations: [to],
    ConfigurationSetName: configSet,
  });
  return ses.send(cmd);
}
