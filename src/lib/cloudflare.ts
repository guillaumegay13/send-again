import {
  buildSesManagedRecords,
  isDmarcTxtValue,
  isSpfTxtValue,
  normalizeDomain,
  normalizeTxtValue,
} from "@/lib/ses-dns-records";

export interface CloudflareCredentialsInput {
  apiToken?: string;
  zoneId?: string;
}

export interface CloudflareCredentials {
  apiToken: string;
  zoneId?: string;
}

export interface ConfigureCloudflareSesDnsResult {
  zoneId: string;
  zoneName: string;
  appliedRecords: number;
  changedRecords: number;
}

interface CloudflareApiError {
  code?: number;
  message?: string;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  errors?: CloudflareApiError[];
  result: T;
}

interface CloudflareZone {
  id: string;
  name: string;
}

interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

type CloudflareRecordMergeMode = "replace" | "additive" | "spf" | "dmarc";

interface CloudflareManagedRecord {
  type: "TXT" | "CNAME";
  name: string;
  content: string;
  mode: CloudflareRecordMergeMode;
}

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

function normalizeCredentialField(
  value: string | undefined,
  fieldName: string
): string {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    throw new Error(`Missing Cloudflare credential: ${fieldName}`);
  }
  return normalized;
}

function normalizeCloudflareZoneId(value: string | undefined): string | undefined {
  const normalized = (value ?? "").trim();
  return normalized || undefined;
}

function buildCloudflareManagedRecords(
  domain: string,
  verificationToken: string,
  dkimTokens: string[]
): CloudflareManagedRecord[] {
  return buildSesManagedRecords(domain, verificationToken, dkimTokens).map(
    (record): CloudflareManagedRecord => {
      if (record.kind === "verification") {
        return {
          type: "TXT",
          name: record.name,
          content: record.value,
          mode: "additive",
        };
      }
      if (record.kind === "spf") {
        return {
          type: "TXT",
          name: record.name,
          content: record.value,
          mode: "spf",
        };
      }
      if (record.kind === "dmarc") {
        return {
          type: "TXT",
          name: record.name,
          content: record.value,
          mode: "dmarc",
        };
      }
      return {
        type: "CNAME",
        name: record.name,
        content: record.value,
        mode: "replace",
      };
    }
  );
}

function buildCloudflareApiErrorMessage(
  fallback: string,
  payload: { errors?: CloudflareApiError[] } | null
): string {
  const firstError = payload?.errors?.[0];
  if (!firstError) return fallback;
  const code = firstError.code ? ` (${firstError.code})` : "";
  const message = firstError.message?.trim() || fallback;
  return `${message}${code}`;
}

async function callCloudflareApi<T>({
  credentials,
  method,
  path,
  query,
  body,
}: {
  credentials: CloudflareCredentials;
  method: "GET" | "POST" | "PUT";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
}): Promise<T> {
  const url = new URL(path, CLOUDFLARE_API_BASE);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${credentials.apiToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    redirect: "follow",
  });

  const payload = (await response
    .json()
    .catch(() => null)) as CloudflareApiResponse<T> | null;

  if (!response.ok) {
    throw new Error(
      buildCloudflareApiErrorMessage(
        `Cloudflare API HTTP ${response.status}`,
        payload
      )
    );
  }

  if (!payload?.success) {
    throw new Error(
      buildCloudflareApiErrorMessage("Cloudflare API request failed", payload)
    );
  }

  return payload.result;
}

function buildZoneCandidates(domain: string): string[] {
  const labels = normalizeDomain(domain).split(".").filter(Boolean);
  const candidates: string[] = [];
  for (let start = 0; start < labels.length - 1; start++) {
    const candidate = labels.slice(start).join(".");
    if (!candidate.includes(".")) continue;
    candidates.push(candidate);
  }
  return candidates;
}

function domainInZone(domain: string, zoneName: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedZone = normalizeDomain(zoneName);
  return (
    normalizedDomain === normalizedZone ||
    normalizedDomain.endsWith(`.${normalizedZone}`)
  );
}

async function findCloudflareZone(
  domain: string,
  credentials: CloudflareCredentials
): Promise<CloudflareZone> {
  const normalizedDomain = normalizeDomain(domain);
  if (credentials.zoneId) {
    const zone = await callCloudflareApi<CloudflareZone>({
      credentials,
      method: "GET",
      path: `/zones/${encodeURIComponent(credentials.zoneId)}`,
    });
    if (!domainInZone(normalizedDomain, zone.name)) {
      throw new Error(
        `Provided Cloudflare zone (${zone.name}) does not match ${normalizedDomain}`
      );
    }
    return zone;
  }

  for (const candidate of buildZoneCandidates(normalizedDomain)) {
    const zones = await callCloudflareApi<CloudflareZone[]>({
      credentials,
      method: "GET",
      path: "/zones",
      query: {
        name: candidate,
        status: "active",
        page: 1,
        per_page: 1,
      },
    });
    const zone = zones[0];
    if (zone) return zone;
  }

  throw new Error(
    `No Cloudflare zone found for ${normalizedDomain}. Provide an explicit Zone ID if needed.`
  );
}

function normalizeCloudflareContent(type: string, value: string): string {
  if (type.toUpperCase() === "TXT") {
    return normalizeTxtValue(value);
  }
  return value.trim().replace(/\.+$/, "").toLowerCase();
}

function findReplaceCandidate(
  mode: CloudflareRecordMergeMode,
  existingRecords: CloudflareDnsRecord[]
): CloudflareDnsRecord | null {
  if (mode === "replace") {
    return existingRecords[0] ?? null;
  }
  if (mode === "spf") {
    return (
      existingRecords.find((record) => isSpfTxtValue(record.content)) ?? null
    );
  }
  if (mode === "dmarc") {
    return (
      existingRecords.find((record) => isDmarcTxtValue(record.content)) ?? null
    );
  }
  return null;
}

async function listCloudflareDnsRecords(
  credentials: CloudflareCredentials,
  zoneId: string,
  type: "TXT" | "CNAME",
  name: string
): Promise<CloudflareDnsRecord[]> {
  return callCloudflareApi<CloudflareDnsRecord[]>({
    credentials,
    method: "GET",
    path: `/zones/${encodeURIComponent(zoneId)}/dns_records`,
    query: {
      type,
      name,
      page: 1,
      per_page: 100,
    },
  });
}

async function upsertCloudflareRecord(
  credentials: CloudflareCredentials,
  zoneId: string,
  target: CloudflareManagedRecord
): Promise<boolean> {
  const existingRecords = await listCloudflareDnsRecords(
    credentials,
    zoneId,
    target.type,
    target.name
  );
  const normalizedTarget = normalizeCloudflareContent(
    target.type,
    target.content
  );

  const exactMatch = existingRecords.some(
    (record) =>
      normalizeCloudflareContent(record.type, record.content) ===
      normalizedTarget
  );
  if (exactMatch) return false;

  const body: Record<string, unknown> = {
    type: target.type,
    name: target.name,
    content: target.content,
    ttl: 1,
  };
  if (target.type === "CNAME") {
    body.proxied = false;
  }

  const replaceCandidate = findReplaceCandidate(target.mode, existingRecords);
  if (replaceCandidate) {
    await callCloudflareApi<CloudflareDnsRecord>({
      credentials,
      method: "PUT",
      path: `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(
        replaceCandidate.id
      )}`,
      body,
    });
    return true;
  }

  await callCloudflareApi<CloudflareDnsRecord>({
    credentials,
    method: "POST",
    path: `/zones/${encodeURIComponent(zoneId)}/dns_records`,
    body,
  });
  return true;
}

export function buildCloudflareCredentials(
  input: CloudflareCredentialsInput
): CloudflareCredentials {
  return {
    apiToken: normalizeCredentialField(input.apiToken, "apiToken"),
    zoneId: normalizeCloudflareZoneId(input.zoneId),
  };
}

export async function configureSesDnsInCloudflare(params: {
  domain: string;
  verificationToken: string;
  dkimTokens: string[];
  credentials: CloudflareCredentials;
}): Promise<ConfigureCloudflareSesDnsResult> {
  const normalizedDomain = normalizeDomain(params.domain);
  const zone = await findCloudflareZone(normalizedDomain, params.credentials);
  const managedRecords = buildCloudflareManagedRecords(
    normalizedDomain,
    params.verificationToken,
    params.dkimTokens
  );

  let changedRecords = 0;
  for (const record of managedRecords) {
    const changed = await upsertCloudflareRecord(
      params.credentials,
      zone.id,
      record
    );
    if (changed) changedRecords += 1;
  }

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    appliedRecords: managedRecords.length,
    changedRecords,
  };
}
