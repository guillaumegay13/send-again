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

export async function sendEmail({
  from,
  to,
  subject,
  html,
  configSet,
}: {
  from: string;
  to: string;
  subject: string;
  html: string;
  configSet: string;
}) {
  const cmd = new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Html: { Data: html, Charset: "UTF-8" } },
    },
    ConfigurationSetName: configSet,
  });
  return ses.send(cmd);
}
