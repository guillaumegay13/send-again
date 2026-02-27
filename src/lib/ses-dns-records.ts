export type SesManagedRecordKind = "verification" | "spf" | "dmarc" | "dkim";

export interface SesManagedRecord {
  kind: SesManagedRecordKind;
  type: "TXT" | "CNAME";
  name: string;
  value: string;
}

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, "");
}

export function normalizeTxtValue(value: string): string {
  const trimmed = value.trim();
  const unquoted = trimmed.replace(/^"(.*)"$/, "$1");
  return unquoted.trim();
}

export function isSpfTxtValue(value: string): boolean {
  return normalizeTxtValue(value).toLowerCase().startsWith("v=spf1");
}

export function isDmarcTxtValue(value: string): boolean {
  return normalizeTxtValue(value).toLowerCase().startsWith("v=dmarc1");
}

export function buildSesManagedRecords(
  domain: string,
  verificationToken: string,
  dkimTokens: string[]
): SesManagedRecord[] {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain.includes(".")) {
    throw new Error("Domain must contain at least one dot");
  }

  const normalizedVerificationToken = verificationToken.trim();
  if (!normalizedVerificationToken) {
    throw new Error("Missing SES verification token");
  }

  const uniqueDkimTokens = Array.from(
    new Set(
      dkimTokens
        .map((token) => token.trim())
        .filter(Boolean)
    )
  );
  if (uniqueDkimTokens.length === 0) {
    throw new Error("Missing SES DKIM tokens");
  }

  const records: SesManagedRecord[] = [
    {
      kind: "verification",
      type: "TXT",
      name: `_amazonses.${normalizedDomain}`,
      value: normalizedVerificationToken,
    },
    {
      kind: "spf",
      type: "TXT",
      name: normalizedDomain,
      value: "v=spf1 include:amazonses.com ~all",
    },
    {
      kind: "dmarc",
      type: "TXT",
      name: `_dmarc.${normalizedDomain}`,
      value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${normalizedDomain}`,
    },
  ];

  for (const token of uniqueDkimTokens) {
    records.push({
      kind: "dkim",
      type: "CNAME",
      name: `${token}._domainkey.${normalizedDomain}`,
      value: `${token}.dkim.amazonses.com`,
    });
  }

  return records;
}
