import {
  ChangeResourceRecordSetsCommand,
  GetHostedZoneCommand,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
  type Change,
  type ListHostedZonesCommandOutput,
  type ResourceRecord,
} from "@aws-sdk/client-route-53";
import {
  buildSesManagedRecords,
  isDmarcTxtValue,
  isSpfTxtValue,
  normalizeDomain,
  normalizeTxtValue,
  type SesManagedRecord,
} from "@/lib/ses-dns-records";

export interface Route53ConfigInput {
  hostedZoneId?: string;
}

export interface Route53Config {
  hostedZoneId?: string;
}

export interface ConfigureRoute53SesDnsResult {
  hostedZoneId: string;
  zoneName: string;
  appliedRecords: number;
  changedRecords: number;
}

interface HostedZoneMatch {
  hostedZoneId: string;
  zoneName: string;
}

const route53 = new Route53Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

function normalizeHostedZoneId(value: string | undefined): string | undefined {
  const normalized = (value ?? "").trim();
  if (!normalized) return undefined;
  if (normalized.startsWith("/hostedzone/")) {
    return normalized.slice("/hostedzone/".length);
  }
  return normalized;
}

function ensureTrailingDot(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function stripTrailingDot(value: string): string {
  return value.trim().replace(/\.+$/, "");
}

function quoteRoute53TxtValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function unquoteRoute53TxtValue(value: string): string {
  return normalizeTxtValue(value.replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
}

function normalizeStringSet(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeRoute53CnameValue(value: string): string {
  return stripTrailingDot(value).toLowerCase();
}

function domainInZone(domain: string, zoneName: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedZone = normalizeDomain(zoneName);
  return (
    normalizedDomain === normalizedZone ||
    normalizedDomain.endsWith(`.${normalizedZone}`)
  );
}

function normalizeResourceRecordValues(records: ResourceRecord[] | undefined): string[] {
  return (records ?? [])
    .map((record) => record.Value ?? "")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function getHostedZoneById(
  hostedZoneId: string,
  domain: string
): Promise<HostedZoneMatch> {
  const response = await route53.send(
    new GetHostedZoneCommand({ Id: hostedZoneId })
  );
  const zoneName = normalizeDomain(response.HostedZone?.Name ?? "");
  if (!zoneName) {
    throw new Error(`Unable to read Route53 hosted zone ${hostedZoneId}`);
  }
  if (!domainInZone(domain, zoneName)) {
    throw new Error(
      `Route53 hosted zone ${zoneName} does not match ${domain}`
    );
  }
  return {
    hostedZoneId,
    zoneName,
  };
}

async function listAllHostedZones(): Promise<HostedZoneMatch[]> {
  const zones: HostedZoneMatch[] = [];
  let marker: string | undefined = undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response: ListHostedZonesCommandOutput = await route53.send(
      new ListHostedZonesCommand({ Marker: marker })
    );

    for (const zone of response.HostedZones ?? []) {
      const zoneId = normalizeHostedZoneId(zone.Id);
      const zoneName = normalizeDomain(zone.Name ?? "");
      if (!zoneId || !zoneName) continue;
      zones.push({
        hostedZoneId: zoneId,
        zoneName,
      });
    }

    isTruncated = Boolean(response.IsTruncated);
    marker = response.NextMarker;
  }

  return zones;
}

async function findHostedZoneForDomain(
  domain: string,
  config: Route53Config
): Promise<HostedZoneMatch> {
  if (config.hostedZoneId) {
    return getHostedZoneById(config.hostedZoneId, domain);
  }

  const candidates = (await listAllHostedZones()).filter((zone) =>
    domainInZone(domain, zone.zoneName)
  );
  candidates.sort((a, b) => b.zoneName.length - a.zoneName.length);

  const best = candidates[0];
  if (!best) {
    throw new Error(
      `No Route53 hosted zone found for ${domain}. Set a hosted zone id in the UI or ROUTE53_HOSTED_ZONE_ID.`
    );
  }
  return best;
}

async function getCurrentRecordSetValues(params: {
  hostedZoneId: string;
  recordName: string;
  recordType: "TXT" | "CNAME";
}): Promise<string[]> {
  const canonicalRecordName = ensureTrailingDot(params.recordName);
  const response = await route53.send(
    new ListResourceRecordSetsCommand({
      HostedZoneId: params.hostedZoneId,
      StartRecordName: canonicalRecordName,
      StartRecordType: params.recordType,
      MaxItems: 1,
    })
  );

  const recordSet = response.ResourceRecordSets?.[0];
  if (!recordSet) return [];

  const sameName =
    ensureTrailingDot(recordSet.Name ?? "").toLowerCase() ===
    canonicalRecordName.toLowerCase();
  const sameType = (recordSet.Type ?? "").toUpperCase() === params.recordType;
  if (!sameName || !sameType) return [];

  return normalizeResourceRecordValues(recordSet.ResourceRecords);
}

function buildDesiredTxtValues(
  record: SesManagedRecord,
  existingValues: string[]
): string[] {
  const normalizedExisting = existingValues.map(unquoteRoute53TxtValue);

  if (record.kind === "verification") {
    return normalizeStringSet([...normalizedExisting, record.value]);
  }

  if (record.kind === "spf") {
    return normalizeStringSet([
      ...normalizedExisting.filter((value) => !isSpfTxtValue(value)),
      record.value,
    ]);
  }

  if (record.kind === "dmarc") {
    return normalizeStringSet([
      ...normalizedExisting.filter((value) => !isDmarcTxtValue(value)),
      record.value,
    ]);
  }

  return normalizeStringSet(normalizedExisting);
}

function buildTxtChange(params: {
  recordName: string;
  ttl: number;
  values: string[];
}): Change {
  return {
    Action: "UPSERT",
    ResourceRecordSet: {
      Name: ensureTrailingDot(params.recordName),
      Type: "TXT",
      TTL: params.ttl,
      ResourceRecords: params.values.map((value) => ({
        Value: quoteRoute53TxtValue(value),
      })),
    },
  };
}

function buildCnameChange(params: {
  recordName: string;
  ttl: number;
  value: string;
}): Change {
  return {
    Action: "UPSERT",
    ResourceRecordSet: {
      Name: ensureTrailingDot(params.recordName),
      Type: "CNAME",
      TTL: params.ttl,
      ResourceRecords: [{ Value: ensureTrailingDot(params.value) }],
    },
  };
}

export function buildRoute53Config(input: Route53ConfigInput): Route53Config {
  return {
    hostedZoneId: normalizeHostedZoneId(input.hostedZoneId),
  };
}

export async function configureSesDnsInRoute53(params: {
  domain: string;
  verificationToken: string;
  dkimTokens: string[];
  config: Route53Config;
}): Promise<ConfigureRoute53SesDnsResult> {
  const normalizedDomain = normalizeDomain(params.domain);
  const hostedZone = await findHostedZoneForDomain(normalizedDomain, params.config);
  const managedRecords = buildSesManagedRecords(
    normalizedDomain,
    params.verificationToken,
    params.dkimTokens
  );
  const changes: Change[] = [];
  const ttl = 300;

  for (const record of managedRecords) {
    if (record.type === "TXT") {
      const existingValues = await getCurrentRecordSetValues({
        hostedZoneId: hostedZone.hostedZoneId,
        recordName: record.name,
        recordType: "TXT",
      });
      const nextValues = buildDesiredTxtValues(record, existingValues);
      const existingNormalized = normalizeStringSet(
        existingValues.map(unquoteRoute53TxtValue)
      );
      if (JSON.stringify(existingNormalized) === JSON.stringify(nextValues)) {
        continue;
      }

      changes.push(
        buildTxtChange({
          recordName: record.name,
          ttl,
          values: nextValues,
        })
      );
      continue;
    }

    const existingValues = await getCurrentRecordSetValues({
      hostedZoneId: hostedZone.hostedZoneId,
      recordName: record.name,
      recordType: "CNAME",
    });
    const existingNormalized = normalizeStringSet(
      existingValues.map(normalizeRoute53CnameValue)
    );
    const targetNormalized = normalizeRoute53CnameValue(record.value);
    if (
      existingNormalized.length === 1 &&
      existingNormalized[0] === targetNormalized
    ) {
      continue;
    }

    changes.push(
      buildCnameChange({
        recordName: record.name,
        ttl,
        value: record.value,
      })
    );
  }

  if (changes.length > 0) {
    await route53.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: hostedZone.hostedZoneId,
        ChangeBatch: {
          Comment: "SES DNS auto-sync from send-again",
          Changes: changes,
        },
      })
    );
  }

  return {
    hostedZoneId: hostedZone.hostedZoneId,
    zoneName: hostedZone.zoneName,
    appliedRecords: managedRecords.length,
    changedRecords: changes.length,
  };
}
