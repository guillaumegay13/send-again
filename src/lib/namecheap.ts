export interface NamecheapCredentialsInput {
  apiUser?: string;
  username?: string;
  apiKey?: string;
  clientIp?: string;
  useSandbox?: boolean;
}

export interface NamecheapCredentials {
  apiUser: string;
  username: string;
  apiKey: string;
  clientIp: string;
  useSandbox: boolean;
}

export interface NamecheapHostRecord {
  name: string;
  type: string;
  address: string;
  ttl: number;
  mxPref: number;
}

export interface ConfigureNamecheapSesDnsResult {
  zoneDomain: string;
  existingRecords: number;
  replacedRecords: number;
  totalRecords: number;
  appliedRecords: number;
}

interface NamecheapZoneContext {
  zoneDomain: string;
  sld: string;
  tld: string;
  records: NamecheapHostRecord[];
}

interface ManagedRecord {
  record: NamecheapHostRecord;
  shouldReplace: (record: NamecheapHostRecord) => boolean;
}

const NAMECHEAP_API_URL = "https://api.namecheap.com/xml.response";
const NAMECHEAP_SANDBOX_API_URL = "https://api.sandbox.namecheap.com/xml.response";
const DEFAULT_TTL = 1800;
const DEFAULT_MX_PREF = 10;
const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

class NamecheapApiError extends Error {
  readonly code: string | null;

  constructor(message: string, code?: string | null) {
    super(message);
    this.name = "NamecheapApiError";
    this.code = code ?? null;
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const matcher = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
  for (const match of raw.matchAll(matcher)) {
    const key = match[1];
    const value = match[2];
    if (!key) continue;
    attrs[key] = decodeXmlEntities(value ?? "");
  }
  return attrs;
}

function extractApiErrors(xml: string): Array<{ code: string | null; message: string }> {
  const errors: Array<{ code: string | null; message: string }> = [];
  const matcher = /<Error\b([^>]*)>([\s\S]*?)<\/Error>/gi;

  for (const match of xml.matchAll(matcher)) {
    const attrRaw = match[1] ?? "";
    const message = decodeXmlEntities((match[2] ?? "").trim());
    const attrs = parseXmlAttributes(attrRaw);
    errors.push({
      code: attrs.Number ?? null,
      message,
    });
  }

  return errors;
}

function assertNamecheapSuccess(xml: string): void {
  const statusMatch = xml.match(/<ApiResponse\b[^>]*Status="([^"]+)"/i);
  const status = statusMatch?.[1]?.toUpperCase() ?? "";
  if (status === "OK") return;

  const errors = extractApiErrors(xml);
  if (errors.length > 0) {
    const first = errors[0];
    throw new NamecheapApiError(first?.message ?? "Namecheap API request failed", first?.code);
  }

  throw new NamecheapApiError("Namecheap API request failed");
}

function parseHostRecordsFromXml(xml: string): NamecheapHostRecord[] {
  const records: NamecheapHostRecord[] = [];
  const matcher = /<host\b([^>]*?)\/?>/gi;

  for (const match of xml.matchAll(matcher)) {
    const attrs = parseXmlAttributes(match[1] ?? "");
    const name = attrs.Name?.trim() || "@";
    const type = (attrs.Type ?? "").trim().toUpperCase();
    const address = (attrs.Address ?? "").trim();
    if (!type || !address) continue;

    const ttlRaw = Number(attrs.TTL ?? DEFAULT_TTL);
    const mxPrefRaw = Number(attrs.MXPref ?? DEFAULT_MX_PREF);

    records.push({
      name,
      type,
      address,
      ttl: Number.isFinite(ttlRaw) ? Math.max(60, Math.floor(ttlRaw)) : DEFAULT_TTL,
      mxPref: Number.isFinite(mxPrefRaw) ? Math.max(0, Math.floor(mxPrefRaw)) : DEFAULT_MX_PREF,
    });
  }

  return records;
}

function normalizeTxtValue(value: string): string {
  const trimmed = value.trim();
  const unquoted = trimmed.replace(/^"(.*)"$/, "$1");
  return unquoted.trim();
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/, "");
}

function toRelativeHost(fqdn: string, zoneDomain: string): string {
  const normalizedFqdn = normalizeDomain(fqdn);
  const normalizedZone = normalizeDomain(zoneDomain);

  if (normalizedFqdn === normalizedZone) return "@";
  if (!normalizedFqdn.endsWith(`.${normalizedZone}`)) {
    throw new Error(`Domain ${normalizedFqdn} is outside Namecheap zone ${normalizedZone}`);
  }

  const host = normalizedFqdn.slice(0, -(normalizedZone.length + 1));
  return host || "@";
}

function isNamecheapZoneMiss(error: unknown): boolean {
  if (!(error instanceof NamecheapApiError)) return false;
  const message = error.message.toLowerCase();
  return (
    (message.includes("domain") && message.includes("not found")) ||
    (message.includes("domain") && message.includes("invalid")) ||
    (message.includes("domain") && message.includes("not associated")) ||
    (message.includes("domain") && message.includes("does not exist"))
  );
}

function recordIdentity(record: NamecheapHostRecord): string {
  return [
    record.name.trim().toLowerCase(),
    record.type.trim().toUpperCase(),
    record.address.trim().toLowerCase(),
    String(record.ttl),
    String(record.mxPref),
  ].join("|");
}

function dedupeRecords(records: NamecheapHostRecord[]): NamecheapHostRecord[] {
  const seen = new Set<string>();
  const deduped: NamecheapHostRecord[] = [];

  for (const record of records) {
    const identity = recordIdentity(record);
    if (seen.has(identity)) continue;
    seen.add(identity);
    deduped.push(record);
  }

  return deduped;
}

async function callNamecheapXmlApi(
  credentials: NamecheapCredentials,
  command: string,
  params: Record<string, string>
): Promise<string> {
  const query = new URLSearchParams({
    ApiUser: credentials.apiUser,
    ApiKey: credentials.apiKey,
    UserName: credentials.username,
    ClientIp: credentials.clientIp,
    Command: command,
  });

  for (const [key, value] of Object.entries(params)) {
    query.set(key, value);
  }

  const baseUrl = credentials.useSandbox ? NAMECHEAP_SANDBOX_API_URL : NAMECHEAP_API_URL;
  const url = `${baseUrl}?${query.toString()}`;
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new NamecheapApiError(
      `Namecheap API HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`
    );
  }

  assertNamecheapSuccess(text);
  return text;
}

async function getNamecheapHosts(
  credentials: NamecheapCredentials,
  sld: string,
  tld: string
): Promise<NamecheapHostRecord[]> {
  const xml = await callNamecheapXmlApi(credentials, "namecheap.domains.dns.getHosts", {
    SLD: sld,
    TLD: tld,
  });
  return parseHostRecordsFromXml(xml);
}

async function setNamecheapHosts(
  credentials: NamecheapCredentials,
  sld: string,
  tld: string,
  records: NamecheapHostRecord[]
): Promise<void> {
  if (records.length === 0) {
    throw new Error("Cannot update Namecheap DNS with an empty host record set");
  }

  const params: Record<string, string> = {
    SLD: sld,
    TLD: tld,
  };

  records.forEach((record, index) => {
    const slot = String(index + 1);
    params[`HostName${slot}`] = record.name;
    params[`RecordType${slot}`] = record.type;
    params[`Address${slot}`] = record.address;
    params[`MXPref${slot}`] = String(record.mxPref);
    params[`TTL${slot}`] = String(record.ttl);
  });

  await callNamecheapXmlApi(credentials, "namecheap.domains.dns.setHosts", params);
}

async function resolveZoneContext(
  domain: string,
  credentials: NamecheapCredentials
): Promise<NamecheapZoneContext> {
  const normalized = normalizeDomain(domain);
  const labels = normalized.split(".").filter(Boolean);
  if (labels.length < 2) {
    throw new Error("Domain must contain at least one dot");
  }

  const attemptedZones: string[] = [];
  let lastError: unknown = null;

  for (let start = 0; start < labels.length - 1; start++) {
    const zoneLabels = labels.slice(start);
    if (zoneLabels.length < 2) continue;
    const sld = zoneLabels[0] ?? "";
    const tld = zoneLabels.slice(1).join(".");
    const zoneDomain = zoneLabels.join(".");
    attemptedZones.push(zoneDomain);

    try {
      const records = await getNamecheapHosts(credentials, sld, tld);
      return { zoneDomain, sld, tld, records };
    } catch (error) {
      lastError = error;
      if (isNamecheapZoneMiss(error)) {
        continue;
      }
      throw error;
    }
  }

  if (lastError instanceof Error) {
    throw new Error(
      `No matching Namecheap zone found for ${normalized}. Tried ${attemptedZones.join(", ")}. Last error: ${lastError.message}`
    );
  }

  throw new Error(
    `No matching Namecheap zone found for ${normalized}. Tried ${attemptedZones.join(", ")}.`
  );
}

function isSameNameAndType(
  record: NamecheapHostRecord,
  name: string,
  type: string
): boolean {
  return (
    record.name.trim().toLowerCase() === name.trim().toLowerCase() &&
    record.type.trim().toUpperCase() === type.trim().toUpperCase()
  );
}

function buildManagedSesRecords(
  domain: string,
  zoneDomain: string,
  verificationToken: string,
  dkimTokens: string[]
): ManagedRecord[] {
  const normalizedDomain = normalizeDomain(domain);
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

  const domainHost = toRelativeHost(normalizedDomain, zoneDomain);
  const verificationHost = toRelativeHost(
    `_amazonses.${normalizedDomain}`,
    zoneDomain
  );
  const dmarcHost = toRelativeHost(`_dmarc.${normalizedDomain}`, zoneDomain);

  const managed: ManagedRecord[] = [
    {
      record: {
        name: verificationHost,
        type: "TXT",
        address: normalizedVerificationToken,
        ttl: DEFAULT_TTL,
        mxPref: DEFAULT_MX_PREF,
      },
      shouldReplace: (record) => isSameNameAndType(record, verificationHost, "TXT"),
    },
    {
      record: {
        name: domainHost,
        type: "TXT",
        address: "v=spf1 include:amazonses.com ~all",
        ttl: DEFAULT_TTL,
        mxPref: DEFAULT_MX_PREF,
      },
      shouldReplace: (record) =>
        isSameNameAndType(record, domainHost, "TXT") &&
        normalizeTxtValue(record.address).toLowerCase().startsWith("v=spf1"),
    },
    {
      record: {
        name: dmarcHost,
        type: "TXT",
        address: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${normalizedDomain}`,
        ttl: DEFAULT_TTL,
        mxPref: DEFAULT_MX_PREF,
      },
      shouldReplace: (record) =>
        isSameNameAndType(record, dmarcHost, "TXT") &&
        normalizeTxtValue(record.address).toLowerCase().startsWith("v=dmarc1"),
    },
  ];

  for (const token of uniqueDkimTokens) {
    const dkimHost = toRelativeHost(
      `${token}._domainkey.${normalizedDomain}`,
      zoneDomain
    );
    managed.push({
      record: {
        name: dkimHost,
        type: "CNAME",
        address: `${token}.dkim.amazonses.com`,
        ttl: DEFAULT_TTL,
        mxPref: DEFAULT_MX_PREF,
      },
      shouldReplace: (record) => isSameNameAndType(record, dkimHost, "CNAME"),
    });
  }

  return managed;
}

function mergeManagedRecords(
  existingRecords: NamecheapHostRecord[],
  managedRecords: ManagedRecord[]
): { mergedRecords: NamecheapHostRecord[]; replacedRecords: number } {
  let replacedRecords = 0;
  const retained = existingRecords.filter((record) => {
    const shouldReplace = managedRecords.some((managed) =>
      managed.shouldReplace(record)
    );
    if (shouldReplace) {
      replacedRecords += 1;
      return false;
    }
    return true;
  });

  const mergedRecords = dedupeRecords([
    ...retained,
    ...managedRecords.map((managed) => managed.record),
  ]);

  return { mergedRecords, replacedRecords };
}

function normalizeCredentialField(
  value: string | undefined,
  fieldName: string
): string {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    throw new Error(`Missing Namecheap credential: ${fieldName}`);
  }
  return normalized;
}

export function buildNamecheapCredentials(
  input: NamecheapCredentialsInput
): NamecheapCredentials {
  const credentials: NamecheapCredentials = {
    apiUser: normalizeCredentialField(input.apiUser, "apiUser"),
    username: normalizeCredentialField(input.username, "username"),
    apiKey: normalizeCredentialField(input.apiKey, "apiKey"),
    clientIp: normalizeCredentialField(input.clientIp, "clientIp"),
    useSandbox: Boolean(input.useSandbox),
  };

  if (!IPV4_REGEX.test(credentials.clientIp)) {
    throw new Error("Namecheap clientIp must be a valid IPv4 address");
  }

  return credentials;
}

export async function configureSesDnsInNamecheap(params: {
  domain: string;
  verificationToken: string;
  dkimTokens: string[];
  credentials: NamecheapCredentials;
}): Promise<ConfigureNamecheapSesDnsResult> {
  const normalizedDomain = normalizeDomain(params.domain);
  const zoneContext = await resolveZoneContext(normalizedDomain, params.credentials);
  const managedRecords = buildManagedSesRecords(
    normalizedDomain,
    zoneContext.zoneDomain,
    params.verificationToken,
    params.dkimTokens
  );
  const { mergedRecords, replacedRecords } = mergeManagedRecords(
    zoneContext.records,
    managedRecords
  );

  await setNamecheapHosts(
    params.credentials,
    zoneContext.sld,
    zoneContext.tld,
    mergedRecords
  );

  return {
    zoneDomain: zoneContext.zoneDomain,
    existingRecords: zoneContext.records.length,
    replacedRecords,
    totalRecords: mergedRecords.length,
    appliedRecords: managedRecords.length,
  };
}
