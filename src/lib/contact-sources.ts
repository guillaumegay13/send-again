import type { ContactSourceProvider, DbContact } from "@/lib/db";

interface SyncContactsInput {
  workspaceId: string;
  provider: ContactSourceProvider;
  config: Record<string, string>;
}

type JsonRecord = Record<string, unknown>;
interface FieldMapping {
  header: string;
  path: string;
}

type ProviderSyncFn = (input: SyncContactsInput) => Promise<DbContact[]>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(source: unknown, path: string): unknown {
  const parts = path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let current: unknown = source;

  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }

  return current;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function normalizeFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractRows(payload: unknown, listPath: string): unknown[] {
  if (listPath) {
    const atPath = readPath(payload, listPath);
    if (Array.isArray(atPath)) return atPath;
    throw new Error(`Configured list path \"${listPath}\" is not an array`);
  }

  if (Array.isArray(payload)) return payload;
  throw new Error(
    "Response is not an array at root. Configure listPath to the contacts array."
  );
}

function parseFieldMappings(value: string): FieldMapping[] {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const mappings: FieldMapping[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const separator = line.includes("=") ? "=" : line.includes(":") ? ":" : "";
    if (!separator) {
      throw new Error(
        `Invalid field mapping \"${line}\". Expected format: header=path`
      );
    }
    const index = line.indexOf(separator);
    const header = line.slice(0, index).trim().toLowerCase();
    const path = line.slice(index + 1).trim();
    if (!header || !path) {
      throw new Error(
        `Invalid field mapping \"${line}\". Expected format: header=path`
      );
    }
    if (header === "email") continue;
    if (seen.has(header)) {
      throw new Error(`Duplicate field mapping for header \"${header}\"`);
    }
    seen.add(header);
    mappings.push({ header, path });
  }

  return mappings;
}

function rowsToContacts(
  rows: unknown[],
  emailField: string,
  fieldMappings: FieldMapping[]
): DbContact[] {
  const contactsByEmail = new Map<string, DbContact>();

  for (const row of rows) {
    if (!isRecord(row)) continue;

    const email = normalizeEmail(readPath(row, emailField));
    if (!email || !email.includes("@")) continue;

    const fields: Record<string, string> = {};
    for (const mapping of fieldMappings) {
      fields[mapping.header] = normalizeFieldValue(readPath(row, mapping.path));
    }

    contactsByEmail.set(email, { email, fields });
  }

  return Array.from(contactsByEmail.values());
}

async function syncHttpJson(input: SyncContactsInput): Promise<DbContact[]> {
  const sourceUrl = input.config.url?.trim() || input.config.endpoint?.trim() || "";
  if (!sourceUrl) {
    throw new Error("Integration config is missing URL/endpoint");
  }
  const listPath = input.config.listPath?.trim() ?? "";
  const emailField = input.config.emailField?.trim() || "";
  const fieldMappings = parseFieldMappings(input.config.fieldMappings ?? "");
  if (!emailField) {
    throw new Error("Integration config is missing emailField");
  }

  const token =
    input.config.token?.trim() || process.env.CONTACT_SOURCE_API_TOKEN?.trim() || "";
  const tokenHeader = input.config.tokenHeader?.trim() || "";
  const tokenPrefix = input.config.tokenPrefix?.trim() || "";

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (token) {
    if (!tokenHeader) {
      throw new Error("tokenHeader is required when token is provided");
    }
    headers[tokenHeader] = tokenPrefix ? `${tokenPrefix} ${token}`.trim() : token;
  }

  const timeoutMs = Number(input.config.timeoutMs ?? 15000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));

  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Contact sync failed (${response.status}). ${body.slice(0, 200)}`
    );
  }

  const payload = (await response.json()) as unknown;
  const rows = extractRows(payload, listPath);
  return rowsToContacts(rows, emailField, fieldMappings);
}

const PROVIDERS: Record<ContactSourceProvider, ProviderSyncFn | null> = {
  manual: null,
  http_json: syncHttpJson,
};

export async function syncContactsFromSource(
  input: SyncContactsInput
): Promise<DbContact[]> {
  const provider = PROVIDERS[input.provider];
  if (!provider) {
    throw new Error(
      `No sync provider configured for source \"${input.provider}\"`
    );
  }
  return provider(input);
}
